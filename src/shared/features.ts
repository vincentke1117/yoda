import { z } from 'zod';
import type { Issue, TaskLifecycleStatus } from './tasks';

export const FEATURE_TEMPLATE_ID = 'feature-development-v1';

export const featureStageIds = [
  'problem',
  'design',
  'planning',
  'implementation',
  'verification',
  'documentation',
  'release',
  'done',
] as const;

export const featureStageSchema = z.enum(featureStageIds);
export type FeatureStageId = z.infer<typeof featureStageSchema>;

export const featureStatusIds = ['active', 'blocked', 'completed', 'cancelled'] as const;
export const featureStatusSchema = z.enum(featureStatusIds);
export type FeatureStatus = z.infer<typeof featureStatusSchema>;

export const featureArtifactTypes = [
  'product_spec',
  'ux_design',
  'acceptance_criteria',
  'technical_plan',
  'test_evidence',
  'feature_docs',
  'delivery_summary',
  'pull_request',
  'release_note',
  'seo',
] as const;

export const featureArtifactTypeSchema = z.enum(featureArtifactTypes);
export type FeatureArtifactType = z.infer<typeof featureArtifactTypeSchema>;

export const featureArtifactStatusIds = ['draft', 'reviewed', 'approved', 'stale'] as const;
export const featureArtifactStatusSchema = z.enum(featureArtifactStatusIds);
export type FeatureArtifactStatus = z.infer<typeof featureArtifactStatusSchema>;

export type FeatureArtifact = {
  id: string;
  featureId: string;
  type: FeatureArtifactType;
  title: string;
  uri: string;
  contentHash: string | null;
  /** Task worktree that produced this evidence; null for project-level/manual artifacts. */
  sourceTaskId: string | null;
  /** Team Room provenance for automatically proposed artifacts. */
  sourceRoomId: string | null;
  sourceMessageId: string | null;
  sourceMemberId: string | null;
  status: FeatureArtifactStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
};

export type FeatureTask = {
  taskId: string;
  name: string;
  status: TaskLifecycleStatus;
  archivedAt: string | null;
  /** Active Feature Team Room that makes this Task non-detachable. */
  workflowRoomId: string | null;
};

export type FeatureEventType =
  | 'created'
  | 'updated'
  | 'stage_advanced'
  | 'stage_retreated'
  | 'status_changed'
  | 'task_linked'
  | 'task_unlinked'
  | 'artifact_added'
  | 'artifact_updated'
  | 'artifact_removed'
  | 'handoff_recorded';

export type FeatureEvent = {
  id: string;
  featureId: string;
  type: FeatureEventType;
  actorType: 'user' | 'agent' | 'system';
  payload: Record<string, unknown>;
  createdAt: string;
};

export type FeatureGateBlocker =
  | { code: 'feature_not_active'; status: FeatureStatus }
  | { code: 'problem_required' }
  | { code: 'artifact_missing'; artifactType: FeatureArtifactType }
  | {
      code: 'artifact_unapproved' | 'artifact_stale';
      artifactType: FeatureArtifactType;
      artifactId: string;
    }
  | { code: 'task_required' }
  | { code: 'task_incomplete'; taskIds: string[] };

export type FeatureGateResult = {
  stage: FeatureStageId;
  nextStage: FeatureStageId | null;
  canAdvance: boolean;
  blockers: FeatureGateBlocker[];
};

export type Feature = {
  id: string;
  projectId: string;
  title: string;
  problem: string;
  outcome: string;
  nonGoals: string;
  stage: FeatureStageId;
  status: FeatureStatus;
  templateId: string;
  sourceIssues: Issue[];
  tasks: FeatureTask[];
  artifacts: FeatureArtifact[];
  events: FeatureEvent[];
  gate: FeatureGateResult;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type FeatureSummary = Pick<
  Feature,
  'id' | 'projectId' | 'title' | 'stage' | 'status' | 'gate' | 'createdAt' | 'updatedAt'
> & {
  sourceIssueUrls: string[];
  taskIds: string[];
  taskCount: number;
  artifactCount: number;
};

const featureCreateFieldsSchema = z.object({
  projectId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(240),
  problem: z.string().trim().min(1).max(20_000),
  outcome: z.string().trim().max(20_000).default(''),
  nonGoals: z.string().trim().max(20_000).default(''),
});

export type FeatureCreateInput = z.input<typeof featureCreateFieldsSchema> & {
  sourceIssues?: Issue[];
};

export function parseFeatureCreateInput(input: FeatureCreateInput) {
  const { sourceIssues = [], ...fields } = input;
  return { ...featureCreateFieldsSchema.parse(fields), sourceIssues };
}

export const featureUpdateInputSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    problem: z.string().trim().min(1).max(20_000),
    outcome: z.string().trim().max(20_000),
    nonGoals: z.string().trim().max(20_000),
    status: z.enum(['active', 'blocked', 'cancelled']),
  })
  .partial();
export type FeatureUpdateInput = z.input<typeof featureUpdateInputSchema>;

export const featureArtifactCreateInputSchema = z.object({
  type: featureArtifactTypeSchema,
  title: z.string().trim().min(1).max(240),
  uri: z.string().trim().min(1).max(4_000),
  contentHash: z.string().trim().max(256).nullable().default(null),
  status: featureArtifactStatusSchema.default('draft'),
});
export type FeatureArtifactCreateInput = z.input<typeof featureArtifactCreateInputSchema>;

export const featureArtifactUpdateInputSchema = featureArtifactCreateInputSchema.partial();
export type FeatureArtifactUpdateInput = z.input<typeof featureArtifactUpdateInputSchema>;

export type FeatureMutationError =
  | { type: 'feature_not_found' }
  | { type: 'task_not_found' }
  | { type: 'cross_project_task' }
  | { type: 'active_workflow_room'; roomId: string }
  | { type: 'artifact_not_found' }
  | { type: 'already_at_first_stage' };

export type FeatureTransitionError =
  | { type: 'feature_not_found' }
  | { type: 'already_complete' }
  | { type: 'gate_blocked'; gate: FeatureGateResult };

export const featureRequiredArtifacts: Readonly<
  Partial<Record<FeatureStageId, readonly FeatureArtifactType[]>>
> = {
  design: ['product_spec', 'ux_design', 'acceptance_criteria'],
  planning: ['technical_plan'],
  verification: ['test_evidence'],
  documentation: ['feature_docs'],
  release: ['delivery_summary', 'pull_request', 'release_note', 'seo'],
};

export function getNextFeatureStage(stage: FeatureStageId): FeatureStageId | null {
  const index = featureStageIds.indexOf(stage);
  return index < 0 || index === featureStageIds.length - 1 ? null : featureStageIds[index + 1];
}

export function getPreviousFeatureStage(stage: FeatureStageId): FeatureStageId | null {
  const index = featureStageIds.indexOf(stage);
  return index <= 0 ? null : featureStageIds[index - 1];
}

export function evaluateFeatureGate(
  feature: Pick<Feature, 'stage' | 'status' | 'problem' | 'tasks' | 'artifacts'>
): FeatureGateResult {
  const nextStage = getNextFeatureStage(feature.stage);
  if (!nextStage) {
    return { stage: feature.stage, nextStage: null, canAdvance: false, blockers: [] };
  }

  const blockers: FeatureGateBlocker[] = [];
  if (feature.status !== 'active') {
    blockers.push({ code: 'feature_not_active', status: feature.status });
  }

  if (feature.stage === 'problem' && feature.problem.trim().length === 0) {
    blockers.push({ code: 'problem_required' });
  }

  for (const artifactType of featureRequiredArtifacts[feature.stage] ?? []) {
    const artifacts = feature.artifacts.filter((candidate) => candidate.type === artifactType);
    if (artifacts.length === 0) {
      blockers.push({ code: 'artifact_missing', artifactType });
      continue;
    }
    if (artifacts.some((artifact) => artifact.status === 'approved')) continue;
    const staleArtifact = artifacts.find((artifact) => artifact.status === 'stale');
    if (staleArtifact) {
      blockers.push({
        code: 'artifact_stale',
        artifactType,
        artifactId: staleArtifact.id,
      });
    } else {
      blockers.push({
        code: 'artifact_unapproved',
        artifactType,
        artifactId: artifacts[0].id,
      });
    }
  }

  if (feature.stage === 'implementation') {
    if (feature.tasks.length === 0) {
      blockers.push({ code: 'task_required' });
    } else {
      const incompleteTaskIds = feature.tasks
        .filter((task) => task.status !== 'review' && task.status !== 'done')
        .map((task) => task.taskId);
      if (incompleteTaskIds.length > 0) {
        blockers.push({ code: 'task_incomplete', taskIds: incompleteTaskIds });
      }
    }
  }

  return {
    stage: feature.stage,
    nextStage,
    canAdvance: blockers.length === 0,
    blockers,
  };
}

export function toFeatureSummary(feature: Feature): FeatureSummary {
  return {
    id: feature.id,
    projectId: feature.projectId,
    title: feature.title,
    stage: feature.stage,
    status: feature.status,
    gate: feature.gate,
    sourceIssueUrls: feature.sourceIssues.map((issue) => issue.url),
    taskIds: feature.tasks.map((task) => task.taskId),
    taskCount: feature.tasks.length,
    artifactCount: feature.artifacts.length,
    createdAt: feature.createdAt,
    updatedAt: feature.updatedAt,
  };
}
