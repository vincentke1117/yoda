import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { featureUpdatedChannel } from '@shared/events/featureEvents';
import {
  evaluateFeatureGate,
  FEATURE_TEMPLATE_ID,
  featureArtifactCreateInputSchema,
  featureArtifactStatusSchema,
  featureArtifactTypeSchema,
  featureArtifactUpdateInputSchema,
  featureStageSchema,
  featureStatusSchema,
  featureUpdateInputSchema,
  getPreviousFeatureStage,
  parseFeatureCreateInput,
  toFeatureSummary,
  type Feature,
  type FeatureArtifact,
  type FeatureArtifactCreateInput,
  type FeatureArtifactUpdateInput,
  type FeatureCreateInput,
  type FeatureEvent,
  type FeatureEventType,
  type FeatureMutationError,
  type FeatureStageId,
  type FeatureStatus,
  type FeatureSummary,
  type FeatureTransitionError,
  type FeatureUpdateInput,
} from '@shared/features';
import { err, ok, type Result } from '@shared/result';
import type { TaskLifecycleStatus } from '@shared/tasks';
import { issueRecordToIssue, upsertIssueRecords } from '@main/core/issues/issue-records';
import { db } from '@main/db/client';
import {
  featureArtifacts,
  featureEvents,
  featureIssueLinks,
  features,
  featureTaskLinks,
  issueRecords,
  tasks,
  type FeatureArtifactRow,
  type FeatureEventRow,
  type FeatureRow,
} from '@main/db/schema';
import { events } from '@main/lib/events';

const taskStatuses = new Set<TaskLifecycleStatus>([
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
]);

const featureEventTypes = new Set<FeatureEventType>([
  'created',
  'updated',
  'stage_advanced',
  'stage_retreated',
  'status_changed',
  'task_linked',
  'task_unlinked',
  'artifact_added',
  'artifact_updated',
  'artifact_removed',
]);

function parseStage(value: string): FeatureStageId {
  const parsed = featureStageSchema.safeParse(value);
  return parsed.success ? parsed.data : 'problem';
}

function parseStatus(value: string): FeatureStatus {
  const parsed = featureStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : 'active';
}

function parseTaskStatus(value: string): TaskLifecycleStatus {
  return taskStatuses.has(value as TaskLifecycleStatus) ? (value as TaskLifecycleStatus) : 'todo';
}

function toArtifact(row: FeatureArtifactRow): FeatureArtifact | null {
  const type = featureArtifactTypeSchema.safeParse(row.type);
  const status = featureArtifactStatusSchema.safeParse(row.status);
  if (!type.success || !status.success) return null;
  return {
    id: row.id,
    featureId: row.featureId,
    type: type.data,
    title: row.title,
    uri: row.uri,
    contentHash: row.contentHash,
    status: status.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    approvedAt: row.approvedAt,
  };
}

function toEvent(row: FeatureEventRow): FeatureEvent {
  return {
    id: row.id,
    featureId: row.featureId,
    type: featureEventTypes.has(row.type as FeatureEventType)
      ? (row.type as FeatureEventType)
      : 'updated',
    actorType: row.actorType === 'agent' || row.actorType === 'system' ? row.actorType : 'user',
    payload: row.payload,
    createdAt: row.createdAt,
  };
}

/**
 * FeatureService owns the delivery aggregate. Renderer surfaces never mutate a
 * stage directly: every transition is evaluated against the current artifacts
 * and linked tasks here, then recorded in the immutable event ledger.
 */
export class FeatureService {
  async list(projectId: string): Promise<FeatureSummary[]> {
    const rows = await db
      .select()
      .from(features)
      .where(eq(features.projectId, projectId))
      .orderBy(desc(features.updatedAt), desc(features.createdAt));
    return (await this.hydrate(rows, { includeEvents: false })).map(toFeatureSummary);
  }

  async get(projectId: string, featureId: string): Promise<Feature | null> {
    const [row] = await db
      .select()
      .from(features)
      .where(and(eq(features.id, featureId), eq(features.projectId, projectId)))
      .limit(1);
    if (!row) return null;
    return (await this.hydrate([row]))[0] ?? null;
  }

  async create(input: FeatureCreateInput): Promise<Feature> {
    const parsed = parseFeatureCreateInput(input);
    const sourceIssues = await upsertIssueRecords(parsed.sourceIssues);
    if (sourceIssues.length > 0) {
      const [existing] = await db
        .select({ id: features.id })
        .from(featureIssueLinks)
        .innerJoin(features, eq(featureIssueLinks.featureId, features.id))
        .where(
          and(
            eq(features.projectId, parsed.projectId),
            inArray(
              featureIssueLinks.issueUrl,
              sourceIssues.map((issue) => issue.url)
            )
          )
        )
        .limit(1);
      if (existing) return (await this.get(parsed.projectId, existing.id)) as Feature;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    await db.insert(features).values({
      id,
      projectId: parsed.projectId,
      title: parsed.title,
      problem: parsed.problem,
      outcome: parsed.outcome,
      nonGoals: parsed.nonGoals,
      stage: 'problem',
      status: 'active',
      templateId: FEATURE_TEMPLATE_ID,
      createdAt: now,
      updatedAt: now,
    });

    if (sourceIssues.length > 0) {
      await db
        .insert(featureIssueLinks)
        .values(
          sourceIssues.map((issue) => ({ featureId: id, issueUrl: issue.url, createdAt: now }))
        )
        .onConflictDoNothing();
    }

    await this.appendEvent(
      id,
      'created',
      { sourceIssueUrls: sourceIssues.map((issue) => issue.url) },
      now,
      false
    );
    events.emit(featureUpdatedChannel, { projectId: parsed.projectId, featureId: id });
    return (await this.get(parsed.projectId, id)) as Feature;
  }

  async update(
    projectId: string,
    featureId: string,
    input: FeatureUpdateInput
  ): Promise<Feature | null> {
    const [existing] = await db
      .select()
      .from(features)
      .where(and(eq(features.id, featureId), eq(features.projectId, projectId)))
      .limit(1);
    if (!existing) return null;
    const parsedPatch = featureUpdateInputSchema.parse(input);
    // Completion is a stage invariant, not a free-form status. Reopen through
    // retreat() so stage, completedAt, and the event ledger stay consistent.
    const patch =
      existing.status === 'completed' && parsedPatch.status !== undefined
        ? Object.fromEntries(Object.entries(parsedPatch).filter(([field]) => field !== 'status'))
        : parsedPatch;
    if (Object.keys(patch).length === 0) return this.get(projectId, featureId);

    const now = new Date().toISOString();
    await db
      .update(features)
      .set({ ...patch, updatedAt: now })
      .where(eq(features.id, featureId));
    const statusChanged = patch.status !== undefined && patch.status !== existing.status;
    await this.appendEvent(
      featureId,
      statusChanged ? 'status_changed' : 'updated',
      statusChanged ? { from: existing.status, to: patch.status } : { fields: Object.keys(patch) },
      now,
      false
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return this.get(projectId, featureId);
  }

  async advance(
    projectId: string,
    featureId: string
  ): Promise<Result<Feature, FeatureTransitionError>> {
    const feature = await this.get(projectId, featureId);
    if (!feature) return err({ type: 'feature_not_found' });
    if (!feature.gate.nextStage) return err({ type: 'already_complete' });
    if (!feature.gate.canAdvance) return err({ type: 'gate_blocked', gate: feature.gate });

    const now = new Date().toISOString();
    const nextStage = feature.gate.nextStage;
    const completed = nextStage === 'done';
    await db
      .update(features)
      .set({
        stage: nextStage,
        status: completed ? 'completed' : 'active',
        completedAt: completed ? now : null,
        updatedAt: now,
      })
      .where(eq(features.id, featureId));
    await this.appendEvent(
      featureId,
      'stage_advanced',
      { from: feature.stage, to: nextStage },
      now,
      false
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  async retreat(
    projectId: string,
    featureId: string
  ): Promise<Result<Feature, FeatureMutationError>> {
    const feature = await this.get(projectId, featureId);
    if (!feature) return err({ type: 'feature_not_found' });
    const previousStage = getPreviousFeatureStage(feature.stage);
    if (!previousStage) return err({ type: 'already_at_first_stage' });

    const now = new Date().toISOString();
    await db
      .update(features)
      .set({ stage: previousStage, status: 'active', completedAt: null, updatedAt: now })
      .where(eq(features.id, featureId));
    await this.appendEvent(
      featureId,
      'stage_retreated',
      { from: feature.stage, to: previousStage },
      now,
      false
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  async setTaskLinked(
    projectId: string,
    featureId: string,
    taskId: string,
    linked: boolean
  ): Promise<Result<Feature, FeatureMutationError>> {
    const [feature] = await db
      .select({ id: features.id })
      .from(features)
      .where(and(eq(features.id, featureId), eq(features.projectId, projectId)))
      .limit(1);
    if (!feature) return err({ type: 'feature_not_found' });
    const [task] = await db
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) return err({ type: 'task_not_found' });
    if (task.projectId !== projectId) return err({ type: 'cross_project_task' });

    const now = new Date().toISOString();
    if (linked) {
      await db
        .insert(featureTaskLinks)
        .values({ featureId, taskId, createdAt: now })
        .onConflictDoNothing();
    } else {
      await db
        .delete(featureTaskLinks)
        .where(and(eq(featureTaskLinks.featureId, featureId), eq(featureTaskLinks.taskId, taskId)));
    }
    await this.appendEvent(featureId, linked ? 'task_linked' : 'task_unlinked', { taskId }, now);
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  async addArtifact(
    projectId: string,
    featureId: string,
    input: FeatureArtifactCreateInput
  ): Promise<Result<Feature, FeatureMutationError>> {
    if (!(await this.exists(projectId, featureId))) return err({ type: 'feature_not_found' });
    const parsed = featureArtifactCreateInputSchema.parse(input);
    const now = new Date().toISOString();
    const artifactId = randomUUID();
    await db.insert(featureArtifacts).values({
      id: artifactId,
      featureId,
      ...parsed,
      approvedAt: parsed.status === 'approved' ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    await this.appendEvent(
      featureId,
      'artifact_added',
      { artifactId, artifactType: parsed.type },
      now
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  async updateArtifact(
    projectId: string,
    featureId: string,
    artifactId: string,
    input: FeatureArtifactUpdateInput
  ): Promise<Result<Feature, FeatureMutationError>> {
    if (!(await this.exists(projectId, featureId))) return err({ type: 'feature_not_found' });
    const [existing] = await db
      .select()
      .from(featureArtifacts)
      .where(and(eq(featureArtifacts.id, artifactId), eq(featureArtifacts.featureId, featureId)))
      .limit(1);
    if (!existing) return err({ type: 'artifact_not_found' });
    const patch = featureArtifactUpdateInputSchema.parse(input);
    if (Object.keys(patch).length === 0)
      return ok((await this.get(projectId, featureId)) as Feature);

    const now = new Date().toISOString();
    const approvedAt =
      patch.status === undefined
        ? existing.approvedAt
        : patch.status === 'approved'
          ? (existing.approvedAt ?? now)
          : null;
    await db
      .update(featureArtifacts)
      .set({ ...patch, approvedAt, updatedAt: now })
      .where(eq(featureArtifacts.id, artifactId));
    await this.appendEvent(
      featureId,
      'artifact_updated',
      { artifactId, fields: Object.keys(patch) },
      now
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  async removeArtifact(
    projectId: string,
    featureId: string,
    artifactId: string
  ): Promise<Result<Feature, FeatureMutationError>> {
    if (!(await this.exists(projectId, featureId))) return err({ type: 'feature_not_found' });
    const [existing] = await db
      .select({ id: featureArtifacts.id, type: featureArtifacts.type })
      .from(featureArtifacts)
      .where(and(eq(featureArtifacts.id, artifactId), eq(featureArtifacts.featureId, featureId)))
      .limit(1);
    if (!existing) return err({ type: 'artifact_not_found' });
    await db.delete(featureArtifacts).where(eq(featureArtifacts.id, artifactId));
    const now = new Date().toISOString();
    await this.appendEvent(
      featureId,
      'artifact_removed',
      { artifactId, artifactType: existing.type },
      now
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  private async exists(projectId: string, featureId: string): Promise<boolean> {
    const rows = await db
      .select({ id: features.id })
      .from(features)
      .where(and(eq(features.id, featureId), eq(features.projectId, projectId)))
      .limit(1);
    return rows.length > 0;
  }

  private async appendEvent(
    featureId: string,
    type: FeatureEventType,
    payload: Record<string, unknown>,
    createdAt: string,
    touch = true
  ): Promise<void> {
    await db.insert(featureEvents).values({
      id: randomUUID(),
      featureId,
      type,
      actorType: 'user',
      payload,
      createdAt,
    });
    if (touch) {
      await db.update(features).set({ updatedAt: createdAt }).where(eq(features.id, featureId));
    }
  }

  private async hydrate(
    rows: FeatureRow[],
    { includeEvents = true }: { includeEvents?: boolean } = {}
  ): Promise<Feature[]> {
    if (rows.length === 0) return [];
    const featureIds = rows.map((row) => row.id);
    const [artifactRows, taskRows, issueRows, eventRows] = await Promise.all([
      db
        .select()
        .from(featureArtifacts)
        .where(inArray(featureArtifacts.featureId, featureIds))
        .orderBy(asc(featureArtifacts.createdAt)),
      db
        .select({
          featureId: featureTaskLinks.featureId,
          taskId: tasks.id,
          name: tasks.name,
          status: tasks.status,
          archivedAt: tasks.archivedAt,
        })
        .from(featureTaskLinks)
        .innerJoin(tasks, eq(featureTaskLinks.taskId, tasks.id))
        .where(inArray(featureTaskLinks.featureId, featureIds))
        .orderBy(asc(featureTaskLinks.createdAt)),
      db
        .select({ featureId: featureIssueLinks.featureId, issue: issueRecords })
        .from(featureIssueLinks)
        .innerJoin(issueRecords, eq(featureIssueLinks.issueUrl, issueRecords.url))
        .where(inArray(featureIssueLinks.featureId, featureIds))
        .orderBy(asc(featureIssueLinks.createdAt)),
      includeEvents
        ? db
            .select()
            .from(featureEvents)
            .where(inArray(featureEvents.featureId, featureIds))
            .orderBy(desc(featureEvents.createdAt))
        : Promise.resolve([]),
    ]);

    const artifactsByFeature = new Map<string, FeatureArtifact[]>();
    for (const row of artifactRows) {
      const artifact = toArtifact(row);
      if (!artifact) continue;
      const artifacts = artifactsByFeature.get(row.featureId) ?? [];
      artifacts.push(artifact);
      artifactsByFeature.set(row.featureId, artifacts);
    }

    const tasksByFeature = new Map<string, Feature['tasks']>();
    for (const row of taskRows) {
      const linkedTasks = tasksByFeature.get(row.featureId) ?? [];
      linkedTasks.push({
        taskId: row.taskId,
        name: row.name,
        status: parseTaskStatus(row.status),
        archivedAt: row.archivedAt,
      });
      tasksByFeature.set(row.featureId, linkedTasks);
    }

    const issuesByFeature = new Map<string, Feature['sourceIssues']>();
    for (const row of issueRows) {
      const issues = issuesByFeature.get(row.featureId) ?? [];
      issues.push(issueRecordToIssue(row.issue));
      issuesByFeature.set(row.featureId, issues);
    }

    const eventsByFeature = new Map<string, FeatureEvent[]>();
    for (const row of eventRows) {
      const featureHistory = eventsByFeature.get(row.featureId) ?? [];
      featureHistory.push(toEvent(row));
      eventsByFeature.set(row.featureId, featureHistory);
    }

    return rows.map((row) => {
      const base = {
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        problem: row.problem,
        outcome: row.outcome,
        nonGoals: row.nonGoals,
        stage: parseStage(row.stage),
        status: parseStatus(row.status),
        templateId: row.templateId,
        sourceIssues: issuesByFeature.get(row.id) ?? [],
        tasks: tasksByFeature.get(row.id) ?? [],
        artifacts: artifactsByFeature.get(row.id) ?? [],
        events: eventsByFeature.get(row.id) ?? [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        completedAt: row.completedAt,
      };
      return { ...base, gate: evaluateFeatureGate(base) };
    });
  }
}

export const featureService = new FeatureService();
