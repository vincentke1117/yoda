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
import { getIssuesForTasks } from '@main/core/tasks/operations/task-issues';
import { db } from '@main/db/client';
import {
  featureArtifacts,
  featureEvents,
  featureIssueLinks,
  features,
  featureTaskLinks,
  featureWorkflowOwners,
  issueRecords,
  tasks,
  teamRooms,
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
  'handoff_recorded',
]);

type FeatureActorType = FeatureEvent['actorType'];

export type FeatureArtifactProposal = Pick<
  FeatureArtifactCreateInput,
  'type' | 'title' | 'uri' | 'contentHash'
>;

export type FeatureHandoffProvenance = {
  taskId: string;
  roomId: string;
  messageId: string;
  memberId: string;
  stage: FeatureStageId;
  verdict: 'ready' | 'blocked';
  evidence: string;
};

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
    sourceTaskId: row.sourceTaskId,
    sourceRoomId: row.sourceRoomId,
    sourceMessageId: row.sourceMessageId,
    sourceMemberId: row.sourceMemberId,
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

  /** Active delivery aggregates already owning this Task. */
  async listForTask(projectId: string, taskId: string): Promise<Feature[]> {
    const rows = await db
      .select({ feature: features })
      .from(featureTaskLinks)
      .innerJoin(features, eq(featureTaskLinks.featureId, features.id))
      .where(
        and(
          eq(featureTaskLinks.taskId, taskId),
          eq(features.projectId, projectId),
          inArray(features.status, ['active', 'blocked'])
        )
      )
      .orderBy(desc(features.updatedAt), desc(features.createdAt));
    return this.hydrate(rows.map((row) => row.feature));
  }

  /**
   * Idempotently find or create the authoritative Feature for a workflow Task.
   * Ambiguity is surfaced instead of silently attaching a Room to an arbitrary
   * aggregate.
   */
  async ensureForTask(
    projectId: string,
    taskId: string,
    problem: string,
    actorType: FeatureActorType = 'agent'
  ): Promise<Feature> {
    const [task] = await db
      .select({ id: tasks.id, projectId: tasks.projectId, name: tasks.name })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.projectId !== projectId) throw new Error(`Task ${taskId} belongs to another project`);

    const issues = (await getIssuesForTasks([taskId])).get(taskId) ?? [];
    const issueUrls = issues.map((issue) => issue.url);
    const now = new Date().toISOString();
    const result = db.transaction((tx) => {
      const owner = tx
        .select({ featureId: featureWorkflowOwners.featureId })
        .from(featureWorkflowOwners)
        .where(eq(featureWorkflowOwners.taskId, taskId))
        .limit(1)
        .get();

      let featureId = owner?.featureId ?? null;
      let created = false;
      if (featureId) {
        const ownedFeature = tx
          .select({ projectId: features.projectId })
          .from(features)
          .where(eq(features.id, featureId))
          .limit(1)
          .get();
        if (!ownedFeature || ownedFeature.projectId !== projectId) {
          throw new Error('The Feature workflow owner belongs to another project.');
        }
      } else {
        const linkedCandidates = tx
          .select({ id: features.id })
          .from(featureTaskLinks)
          .innerJoin(features, eq(featureTaskLinks.featureId, features.id))
          .where(
            and(
              eq(featureTaskLinks.taskId, taskId),
              eq(features.projectId, projectId),
              inArray(features.status, ['active', 'blocked'])
            )
          )
          .all();
        const linkedIds = [...new Set(linkedCandidates.map((candidate) => candidate.id))];
        if (linkedIds.length > 1) {
          throw new Error(
            'Multiple active Features are linked to this Task; choose one explicitly.'
          );
        }
        featureId = linkedIds[0] ?? null;

        if (!featureId && issueUrls.length > 0) {
          const issueCandidates = tx
            .select({ id: features.id })
            .from(featureIssueLinks)
            .innerJoin(features, eq(featureIssueLinks.featureId, features.id))
            .where(
              and(
                eq(features.projectId, projectId),
                inArray(features.status, ['active', 'blocked']),
                inArray(featureIssueLinks.issueUrl, issueUrls)
              )
            )
            .all();
          const issueFeatureIds = [...new Set(issueCandidates.map((candidate) => candidate.id))];
          if (issueFeatureIds.length > 1) {
            throw new Error(
              'Multiple active Features match this Task issue; choose one explicitly.'
            );
          }
          featureId = issueFeatureIds[0] ?? null;
        }

        if (!featureId) {
          featureId = randomUUID();
          created = true;
          tx.insert(features)
            .values({
              id: featureId,
              projectId,
              title: task.name,
              problem: problem.trim(),
              outcome: '',
              nonGoals: '',
              stage: 'problem',
              status: 'active',
              templateId: FEATURE_TEMPLATE_ID,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          if (issueUrls.length > 0) {
            tx.insert(featureIssueLinks)
              .values(
                issueUrls.map((issueUrl) => ({ featureId: featureId!, issueUrl, createdAt: now }))
              )
              .onConflictDoNothing()
              .run();
          }
          tx.insert(featureEvents)
            .values({
              id: randomUUID(),
              featureId,
              type: 'created',
              actorType,
              payload: { sourceIssueUrls: issueUrls },
              createdAt: now,
            })
            .run();
        }

        tx.insert(featureWorkflowOwners)
          .values({ taskId, featureId, createdAt: now, updatedAt: now })
          .run();
      }

      const linked = tx
        .insert(featureTaskLinks)
        .values({ featureId, taskId, createdAt: now })
        .onConflictDoNothing()
        .returning({ taskId: featureTaskLinks.taskId })
        .all();
      if (linked.length > 0) {
        tx.insert(featureEvents)
          .values({
            id: randomUUID(),
            featureId,
            type: 'task_linked',
            actorType,
            payload: { taskId },
            createdAt: now,
          })
          .run();
        tx.update(features).set({ updatedAt: now }).where(eq(features.id, featureId)).run();
      }
      return { featureId, changed: created || linked.length > 0 };
    });

    if (result.changed)
      events.emit(featureUpdatedChannel, { projectId, featureId: result.featureId });
    const feature = await this.get(projectId, result.featureId);
    if (!feature) throw new Error(`Feature ${result.featureId} not found after workflow claim`);
    return feature;
  }

  async create(input: FeatureCreateInput, actorType: FeatureActorType = 'user'): Promise<Feature> {
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
            inArray(features.status, ['active', 'blocked']),
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
      { sourceIssueUrls: sourceIssues.map((i) => i.url) },
      now,
      {
        touch: false,
        actorType,
      }
    );
    events.emit(featureUpdatedChannel, { projectId: parsed.projectId, featureId: id });
    return (await this.get(parsed.projectId, id)) as Feature;
  }

  async update(
    projectId: string,
    featureId: string,
    input: FeatureUpdateInput,
    actorType: FeatureActorType = 'user'
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
      { touch: false, actorType }
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return this.get(projectId, featureId);
  }

  async advance(
    projectId: string,
    featureId: string,
    actorType: FeatureActorType = 'user'
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
      { touch: false, actorType }
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  async retreat(
    projectId: string,
    featureId: string,
    actorType: FeatureActorType = 'user'
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
      { touch: false, actorType }
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  async setTaskLinked(
    projectId: string,
    featureId: string,
    taskId: string,
    linked: boolean,
    actorType: FeatureActorType = 'user'
  ): Promise<Result<Feature, FeatureMutationError>> {
    const now = new Date().toISOString();
    const mutation = db.transaction((tx) => {
      const feature = tx
        .select({ id: features.id })
        .from(features)
        .where(and(eq(features.id, featureId), eq(features.projectId, projectId)))
        .limit(1)
        .get();
      if (!feature) return { error: { type: 'feature_not_found' } as FeatureMutationError };
      const task = tx
        .select({ id: tasks.id, projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1)
        .get();
      if (!task) return { error: { type: 'task_not_found' } as FeatureMutationError };
      if (task.projectId !== projectId) {
        return { error: { type: 'cross_project_task' } as FeatureMutationError };
      }

      if (!linked) {
        const activeRoom = tx
          .select({ id: teamRooms.id })
          .from(teamRooms)
          .where(
            and(
              eq(teamRooms.projectId, projectId),
              eq(teamRooms.taskId, taskId),
              eq(teamRooms.featureId, featureId),
              eq(teamRooms.preset, 'feature-workflow'),
              eq(teamRooms.status, 'active')
            )
          )
          .limit(1)
          .get();
        if (activeRoom) {
          return {
            error: {
              type: 'active_workflow_room',
              roomId: activeRoom.id,
            } as FeatureMutationError,
          };
        }
      }

      const changed = linked
        ? tx
            .insert(featureTaskLinks)
            .values({ featureId, taskId, createdAt: now })
            .onConflictDoNothing()
            .returning({ taskId: featureTaskLinks.taskId })
            .all()
        : tx
            .delete(featureTaskLinks)
            .where(
              and(eq(featureTaskLinks.featureId, featureId), eq(featureTaskLinks.taskId, taskId))
            )
            .returning({ taskId: featureTaskLinks.taskId })
            .all();
      if (changed.length === 0) return { changed: false };
      if (!linked) {
        tx.delete(featureWorkflowOwners)
          .where(
            and(
              eq(featureWorkflowOwners.taskId, taskId),
              eq(featureWorkflowOwners.featureId, featureId)
            )
          )
          .run();
      }
      tx.insert(featureEvents)
        .values({
          id: randomUUID(),
          featureId,
          type: linked ? 'task_linked' : 'task_unlinked',
          actorType,
          payload: { taskId },
          createdAt: now,
        })
        .run();
      tx.update(features).set({ updatedAt: now }).where(eq(features.id, featureId)).run();
      return { changed: true };
    });
    if ('error' in mutation && mutation.error) return err(mutation.error);
    if (!mutation.changed) return ok((await this.get(projectId, featureId)) as Feature);
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  async addArtifact(
    projectId: string,
    featureId: string,
    input: FeatureArtifactCreateInput,
    actorType: FeatureActorType = 'user'
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
      now,
      { actorType }
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  async updateArtifact(
    projectId: string,
    featureId: string,
    artifactId: string,
    input: FeatureArtifactUpdateInput,
    actorType: FeatureActorType = 'user'
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
      now,
      { actorType }
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  async removeArtifact(
    projectId: string,
    featureId: string,
    artifactId: string,
    actorType: FeatureActorType = 'user'
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
      now,
      { actorType }
    );
    events.emit(featureUpdatedChannel, { projectId, featureId });
    return ok((await this.get(projectId, featureId)) as Feature);
  }

  /**
   * Main-process-only ingestion for agent evidence. Proposals are always draft,
   * carry their Task/Room provenance, and stale older evidence of the same type.
   * Only the existing user-facing artifact mutation may approve them.
   */
  async proposeArtifacts(
    projectId: string,
    featureId: string,
    proposals: readonly FeatureArtifactProposal[],
    provenance: FeatureHandoffProvenance
  ): Promise<Feature> {
    const parsed = proposals.map((proposal) =>
      featureArtifactCreateInputSchema.parse({ ...proposal, status: 'draft' })
    );
    const changed = db.transaction((tx) => {
      const state = tx
        .select({ status: features.status, stage: features.stage })
        .from(features)
        .where(and(eq(features.id, featureId), eq(features.projectId, projectId)))
        .limit(1)
        .get();
      if (!state) throw new Error(`Feature ${featureId} not found`);
      if (state.status !== 'active') {
        throw new Error(`Feature ${featureId} is ${state.status}; agent evidence is paused.`);
      }
      if (state.stage !== provenance.stage) {
        throw new Error(
          `Feature ${featureId} moved from ${provenance.stage} to ${state.stage}; refresh the hand-off.`
        );
      }
      const taskLink = tx
        .select({ taskId: featureTaskLinks.taskId })
        .from(featureTaskLinks)
        .where(
          and(
            eq(featureTaskLinks.featureId, featureId),
            eq(featureTaskLinks.taskId, provenance.taskId)
          )
        )
        .limit(1)
        .get();
      if (!taskLink) {
        throw new Error(`Task ${provenance.taskId} is not linked to Feature ${featureId}`);
      }
      const history = tx
        .select({ payload: featureEvents.payload })
        .from(featureEvents)
        .where(eq(featureEvents.featureId, featureId))
        .all();
      if (history.some((event) => event.payload.messageId === provenance.messageId)) return false;

      const currentArtifacts = tx
        .select()
        .from(featureArtifacts)
        .where(eq(featureArtifacts.featureId, featureId))
        .all();
      let tick = Date.now();
      for (const proposal of parsed) {
        const prior = currentArtifacts.filter(
          (artifact) => artifact.type === proposal.type && artifact.status !== 'stale'
        );
        for (const artifact of prior) {
          const at = new Date(tick++).toISOString();
          tx.update(featureArtifacts)
            .set({ status: 'stale', approvedAt: null, updatedAt: at })
            .where(eq(featureArtifacts.id, artifact.id))
            .run();
          tx.insert(featureEvents)
            .values({
              id: randomUUID(),
              featureId,
              type: 'artifact_updated',
              actorType: 'agent',
              payload: {
                artifactId: artifact.id,
                fields: ['status'],
                reason: 'superseded_by_agent_handoff',
                messageId: provenance.messageId,
              },
              createdAt: at,
            })
            .run();
        }

        const artifactId = randomUUID();
        const at = new Date(tick++).toISOString();
        tx.insert(featureArtifacts)
          .values({
            id: artifactId,
            featureId,
            ...proposal,
            status: 'draft',
            sourceTaskId: provenance.taskId,
            sourceRoomId: provenance.roomId,
            sourceMessageId: provenance.messageId,
            sourceMemberId: provenance.memberId,
            approvedAt: null,
            createdAt: at,
            updatedAt: at,
          })
          .run();
        tx.insert(featureEvents)
          .values({
            id: randomUUID(),
            featureId,
            type: 'artifact_added',
            actorType: 'agent',
            payload: {
              artifactId,
              artifactType: proposal.type,
              taskId: provenance.taskId,
              roomId: provenance.roomId,
              messageId: provenance.messageId,
              memberId: provenance.memberId,
            },
            createdAt: at,
          })
          .run();
      }

      const handoffAt = new Date(tick).toISOString();
      tx.insert(featureEvents)
        .values({
          id: randomUUID(),
          featureId,
          type: 'handoff_recorded',
          actorType: 'agent',
          payload: provenance,
          createdAt: handoffAt,
        })
        .run();
      tx.update(features).set({ updatedAt: handoffAt }).where(eq(features.id, featureId)).run();
      return true;
    });
    if (changed) events.emit(featureUpdatedChannel, { projectId, featureId });
    return (await this.get(projectId, featureId)) as Feature;
  }

  async recordHandoff(
    projectId: string,
    featureId: string,
    provenance: FeatureHandoffProvenance
  ): Promise<Feature> {
    const now = new Date().toISOString();
    const changed = db.transaction((tx) => {
      const state = tx
        .select({ status: features.status, stage: features.stage })
        .from(features)
        .where(and(eq(features.id, featureId), eq(features.projectId, projectId)))
        .limit(1)
        .get();
      if (!state) throw new Error(`Feature ${featureId} not found`);
      if (state.status !== 'active') {
        throw new Error(`Feature ${featureId} is ${state.status}; agent evidence is paused.`);
      }
      if (state.stage !== provenance.stage) {
        throw new Error(
          `Feature ${featureId} moved from ${provenance.stage} to ${state.stage}; refresh the hand-off.`
        );
      }
      const taskLink = tx
        .select({ taskId: featureTaskLinks.taskId })
        .from(featureTaskLinks)
        .where(
          and(
            eq(featureTaskLinks.featureId, featureId),
            eq(featureTaskLinks.taskId, provenance.taskId)
          )
        )
        .limit(1)
        .get();
      if (!taskLink) {
        throw new Error(`Task ${provenance.taskId} is not linked to Feature ${featureId}`);
      }
      const history = tx
        .select({ payload: featureEvents.payload })
        .from(featureEvents)
        .where(eq(featureEvents.featureId, featureId))
        .all();
      if (history.some((event) => event.payload.messageId === provenance.messageId)) return false;
      tx.insert(featureEvents)
        .values({
          id: randomUUID(),
          featureId,
          type: 'handoff_recorded',
          actorType: 'agent',
          payload: provenance,
          createdAt: now,
        })
        .run();
      tx.update(features).set({ updatedAt: now }).where(eq(features.id, featureId)).run();
      return true;
    });
    if (changed) events.emit(featureUpdatedChannel, { projectId, featureId });
    return (await this.get(projectId, featureId)) as Feature;
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
    { touch = true, actorType = 'user' }: { touch?: boolean; actorType?: FeatureActorType } = {}
  ): Promise<void> {
    await db.insert(featureEvents).values({
      id: randomUUID(),
      featureId,
      type,
      actorType,
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
          workflowRoomId: teamRooms.id,
        })
        .from(featureTaskLinks)
        .innerJoin(tasks, eq(featureTaskLinks.taskId, tasks.id))
        .leftJoin(
          teamRooms,
          and(
            eq(teamRooms.featureId, featureTaskLinks.featureId),
            eq(teamRooms.taskId, featureTaskLinks.taskId),
            eq(teamRooms.preset, 'feature-workflow'),
            eq(teamRooms.status, 'active')
          )
        )
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
        workflowRoomId: row.workflowRoomId,
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
