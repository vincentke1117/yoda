import { describe, expect, it } from 'vitest';
import {
  evaluateFeatureGate,
  featureStageIds,
  getNextFeatureStage,
  getPreviousFeatureStage,
  type Feature,
  type FeatureArtifact,
  type FeatureTask,
} from './features';

const now = '2026-07-13T00:00:00.000Z';

function artifact(
  type: FeatureArtifact['type'],
  status: FeatureArtifact['status'] = 'approved'
): FeatureArtifact {
  return {
    id: type,
    featureId: 'feature-1',
    type,
    title: type,
    uri: `docs/${type}.md`,
    contentHash: null,
    status,
    createdAt: now,
    updatedAt: now,
    approvedAt: status === 'approved' ? now : null,
  };
}

function task(status: FeatureTask['status']): FeatureTask {
  return { taskId: `task-${status}`, name: status, status, archivedAt: null };
}

function subject(
  patch: Partial<Pick<Feature, 'stage' | 'status' | 'problem' | 'tasks' | 'artifacts'>> = {}
) {
  return {
    stage: 'problem' as const,
    status: 'active' as const,
    problem: 'Users cannot follow a feature from idea to delivery.',
    tasks: [],
    artifacts: [],
    ...patch,
  };
}

describe('feature lifecycle', () => {
  it('keeps stage traversal deterministic in both directions', () => {
    expect(featureStageIds.map(getNextFeatureStage)).toEqual([
      'design',
      'planning',
      'implementation',
      'verification',
      'documentation',
      'release',
      'done',
      null,
    ]);
    expect(getPreviousFeatureStage('problem')).toBeNull();
    expect(getPreviousFeatureStage('done')).toBe('release');
  });

  it('requires approved design artifacts before planning', () => {
    const missing = evaluateFeatureGate(subject({ stage: 'design' }));
    expect(missing.canAdvance).toBe(false);
    expect(missing.blockers).toEqual([
      { code: 'artifact_missing', artifactType: 'product_spec' },
      { code: 'artifact_missing', artifactType: 'acceptance_criteria' },
    ]);

    const ready = evaluateFeatureGate(
      subject({
        stage: 'design',
        artifacts: [artifact('product_spec'), artifact('acceptance_criteria')],
      })
    );
    expect(ready).toMatchObject({ canAdvance: true, nextStage: 'planning', blockers: [] });
  });

  it('does not accept stale evidence as approval', () => {
    const gate = evaluateFeatureGate(
      subject({ stage: 'verification', artifacts: [artifact('test_evidence', 'stale')] })
    );
    expect(gate.blockers).toEqual([
      {
        code: 'artifact_stale',
        artifactType: 'test_evidence',
        artifactId: 'test_evidence',
      },
    ]);
  });

  it('accepts an approved artifact when older variants share its type', () => {
    const oldDraft = { ...artifact('technical_plan', 'draft'), id: 'old-draft' };
    const approved = { ...artifact('technical_plan', 'approved'), id: 'approved' };

    expect(
      evaluateFeatureGate(subject({ stage: 'planning', artifacts: [oldDraft, approved] }))
        .canAdvance
    ).toBe(true);
  });

  it.each([
    ['planning', 'technical_plan', 'implementation'],
    ['verification', 'test_evidence', 'documentation'],
    ['documentation', 'feature_docs', 'release'],
    ['release', 'delivery_summary', 'done'],
  ] as const)('guards %s with an approved %s artifact', (stage, artifactType, nextStage) => {
    expect(evaluateFeatureGate(subject({ stage })).blockers).toContainEqual({
      code: 'artifact_missing',
      artifactType,
    });
    expect(
      evaluateFeatureGate(subject({ stage, artifacts: [artifact(artifactType)] }))
    ).toMatchObject({ canAdvance: true, nextStage });
  });

  it('requires linked tasks to reach review or done before verification', () => {
    expect(evaluateFeatureGate(subject({ stage: 'implementation' })).blockers).toEqual([
      { code: 'task_required' },
    ]);

    const blocked = evaluateFeatureGate(
      subject({ stage: 'implementation', tasks: [task('done'), task('in_progress')] })
    );
    expect(blocked.blockers).toEqual([{ code: 'task_incomplete', taskIds: ['task-in_progress'] }]);

    expect(
      evaluateFeatureGate(
        subject({ stage: 'implementation', tasks: [task('review'), task('done')] })
      ).canAdvance
    ).toBe(true);
  });

  it('blocks transitions while the feature is paused or cancelled', () => {
    const gate = evaluateFeatureGate(subject({ status: 'blocked' }));
    expect(gate.blockers).toContainEqual({ code: 'feature_not_active', status: 'blocked' });
  });
});
