import { taskStatusUpdatedChannel } from '@shared/events/taskEvents';
import {
  acceptedFeatureWorkflowStageSignal,
  type FeatureWorkflowArtifactProposal,
} from '@shared/feature-workflow';
import type { Feature, FeatureArtifactType, FeatureStageId } from '@shared/features';
import type { RoomMember, RoomMessage, TeamRoom } from '@shared/team-room';
import { updateTaskStatusForActiveFeatureHandoff } from '@main/core/tasks/operations/updateTaskStatus';
import { events } from '@main/lib/events';
import { featureService } from './feature-service';

const REQUIRED_PROPOSALS: Readonly<
  Partial<Record<FeatureStageId, readonly FeatureArtifactType[]>>
> = {
  design: ['product_spec', 'ux_design', 'acceptance_criteria'],
  planning: ['technical_plan'],
  verification: ['test_evidence'],
  documentation: ['feature_docs'],
  release: ['delivery_summary', 'pull_request', 'release_note', 'seo'],
};

function validateArtifactUri(uri: string): void {
  if (/^https?:\/\//i.test(uri)) return;
  if (uri.startsWith('/') || /^[A-Za-z]:[\\/]/.test(uri)) {
    throw new Error('Feature artifacts must use repository-relative paths or HTTPS URLs.');
  }
  const segments = uri.replace(/\\/g, '/').split('/');
  if (segments.includes('..')) {
    throw new Error('Feature artifact paths cannot leave the Task worktree.');
  }
}

function validateProposals(
  stage: FeatureStageId,
  proposals: readonly FeatureWorkflowArtifactProposal[]
): void {
  const required = REQUIRED_PROPOSALS[stage] ?? [];
  const expected = new Set<FeatureArtifactType>(required);
  const seen = new Set<FeatureArtifactType>();
  for (const proposal of proposals) {
    if (!expected.has(proposal.type)) {
      throw new Error(`Artifact type ${proposal.type} does not belong to Feature stage ${stage}.`);
    }
    if (seen.has(proposal.type)) {
      throw new Error(`Artifact type ${proposal.type} was proposed more than once.`);
    }
    seen.add(proposal.type);
    validateArtifactUri(proposal.uri);
  }
  const missing = required.filter((type) => !seen.has(type));
  if (missing.length > 0) {
    throw new Error(`Feature hand-off is missing required artifacts: ${missing.join(', ')}.`);
  }
}

/**
 * Ingest one current-owner hand-off into the authoritative Feature aggregate.
 * Evidence is proposed as draft and never advances a gate. Implementation-ready
 * means the linked Task enters review, which is its normal lifecycle contract.
 */
export async function ingestFeatureWorkflowHandoff(args: {
  room: TeamRoom;
  feature: Feature;
  members: RoomMember[];
  message: RoomMessage;
}): Promise<boolean> {
  const { room, feature, members, message } = args;
  if (!room.featureId || room.featureId !== feature.id) return false;
  if (feature.status !== 'active') return false;
  const signal = acceptedFeatureWorkflowStageSignal(feature, members, message);
  if (!signal) return false;
  if (feature.stage === 'done') throw new Error('This Feature is already complete.');

  const author = message.authorMemberId
    ? members.find((member) => member.id === message.authorMemberId)
    : null;
  if (!author) throw new Error('Feature hand-off author is missing.');
  const evidence =
    signal.verdict === 'ready'
      ? `${signal.summary} — ${signal.evidence}`
      : `${signal.blocker} — needed: ${signal.needed}${signal.evidence ? ` — ${signal.evidence}` : ''}`;
  const provenance = {
    taskId: room.taskId,
    roomId: room.id,
    messageId: message.id,
    memberId: author.id,
    stage: feature.stage,
    verdict: signal.verdict,
    evidence,
  } as const;

  if (signal.verdict === 'blocked') {
    await featureService.recordHandoff(room.projectId, feature.id, provenance);
    return true;
  }

  validateProposals(feature.stage, signal.artifacts);
  if (feature.stage === 'implementation') {
    const task = feature.tasks.find((candidate) => candidate.taskId === room.taskId);
    if (!task) throw new Error('The workflow Task is no longer linked to this Feature.');
    await featureService.recordHandoff(room.projectId, feature.id, provenance);
    if (task.status !== 'review' && task.status !== 'done') {
      const changed = await updateTaskStatusForActiveFeatureHandoff({
        projectId: room.projectId,
        featureId: feature.id,
        featureStage: 'implementation',
        taskId: room.taskId,
        status: 'review',
      });
      if (changed) {
        events.emit(taskStatusUpdatedChannel, {
          projectId: room.projectId,
          taskId: room.taskId,
          status: 'review',
        });
      }
    }
    return true;
  }

  if (signal.artifacts.length === 0) {
    await featureService.recordHandoff(room.projectId, feature.id, provenance);
  } else {
    await featureService.proposeArtifacts(room.projectId, feature.id, signal.artifacts, provenance);
  }
  return true;
}
