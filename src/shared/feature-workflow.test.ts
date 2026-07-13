import { describe, expect, it } from 'vitest';
import {
  acceptedFeatureWorkflowStageSignal,
  deriveFeatureWorkflowProgress,
  FEATURE_WORKFLOW_STAGES,
  featureWorkflowAllowedTargetHandles,
  featureWorkflowStageForFeatureStage,
  parseFeatureWorkflowStageSignal,
} from './feature-workflow';
import type { Feature, FeatureStageId, FeatureStatus } from './features';
import type { RoomMember, RoomMessage } from './team-room';

function member(handle: string): RoomMember {
  return {
    id: `member-${handle}`,
    roomId: 'room-1',
    conversationId: handle === 'you' ? null : `conversation-${handle}`,
    handle,
    displayName: handle,
    icon: '',
    role: handle === 'you' ? 'lead' : handle === 'orchestrator' ? 'leader' : 'worker',
    runtime: handle === 'you' ? null : 'codex',
    systemPrompt: '',
    skillSelection: null,
    autoApprove: false,
    accent: 'slate',
    status: 'finished',
    createdAt: '2026-07-13T00:00:00.000Z',
  };
}

const members = [member('you'), ...FEATURE_WORKFLOW_STAGES.map((stage) => member(stage.handle))];

function feature(stage: FeatureStageId, status: FeatureStatus = 'active'): Feature {
  return {
    id: 'feature-1',
    projectId: 'project-1',
    title: 'Governed Feature workflow',
    problem: 'Feature delivery loses context.',
    outcome: '',
    nonGoals: '',
    stage,
    status,
    templateId: 'feature-development-v1',
    sourceIssues: [],
    tasks: [
      {
        taskId: 'task-1',
        name: 'Build it',
        status: 'in_progress',
        archivedAt: null,
        workflowRoomId: 'room-1',
      },
    ],
    artifacts: [],
    events: [],
    gate: { stage, nextStage: null, canAdvance: false, blockers: [] },
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    completedAt: status === 'completed' ? '2026-07-13T01:00:00.000Z' : null,
  };
}

function message(
  body: string,
  authorHandle: string,
  mention: string,
  kind: RoomMessage['kind'] = 'handoff'
): RoomMessage {
  return {
    id: `message-${authorHandle}-${mention}`,
    roomId: 'room-1',
    authorMemberId: `member-${authorHandle}`,
    kind,
    body,
    mentions: [mention],
    sessionRef: authorHandle === 'you' ? null : `conversation-${authorHandle}`,
    verdict: null,
    createdAt: '2026-07-13T00:00:01.000Z',
  };
}

const DESIGN_READY =
  '[FEATURE:product-design:ready] {"summary":"design is reviewable","evidence":"criteria checked","artifacts":[{"type":"product_spec","title":"Spec","uri":"docs/design.md"},{"type":"ux_design","title":"UX","uri":"docs/design.md"},{"type":"acceptance_criteria","title":"AC","uri":"docs/design.md"}]}';

describe('feature workflow protocol', () => {
  it('parses a typed ready envelope and rejects prose or invalid JSON', () => {
    expect(parseFeatureWorkflowStageSignal(DESIGN_READY)).toMatchObject({
      stageId: 'product-design',
      verdict: 'ready',
      summary: 'design is reviewable',
      evidence: 'criteria checked',
      artifacts: [
        { type: 'product_spec', title: 'Spec', uri: 'docs/design.md' },
        { type: 'ux_design', title: 'UX', uri: 'docs/design.md' },
        { type: 'acceptance_criteria', title: 'AC', uri: 'docs/design.md' },
      ],
    });
    expect(parseFeatureWorkflowStageSignal('design passed')).toBeNull();
    expect(parseFeatureWorkflowStageSignal('[FEATURE:product-design:ready] not-json')).toBeNull();
    expect(
      parseFeatureWorkflowStageSignal(
        '[FEATURE:product-design:pass] {"summary":"old marker","evidence":"none"}'
      )
    ).toBeNull();
  });

  it('parses a blocked envelope without treating it as aggregate status', () => {
    expect(
      parseFeatureWorkflowStageSignal(
        '[FEATURE:validation:blocked] {"blocker":"regression","needed":"retreat and fix","evidence":"test failed"}'
      )
    ).toMatchObject({
      stageId: 'validation',
      verdict: 'blocked',
      blocker: 'regression',
      needed: 'retreat and fix',
      artifacts: [],
    });
  });

  it('projects the authoritative eight stages into the six-step SOP', () => {
    expect(
      deriveFeatureWorkflowProgress(feature('problem'), members, []).map((x) => x.status)
    ).toEqual(['active', 'pending', 'pending', 'pending', 'pending', 'pending']);
    expect(
      deriveFeatureWorkflowProgress(feature('implementation'), members, []).map((x) => x.status)
    ).toEqual(['completed', 'completed', 'active', 'pending', 'pending', 'pending']);
    expect(
      deriveFeatureWorkflowProgress(feature('done', 'completed'), members, []).every(
        (x) => x.status === 'completed'
      )
    ).toBe(true);
  });

  it('uses Room evidence only as detail and never to advance canonical status', () => {
    const forgedFuture = message(
      '[FEATURE:launch-docs:ready] {"summary":"done","evidence":"claimed","artifacts":[]}',
      'launch-docs',
      'orchestrator'
    );
    const canonical = feature('design');
    canonical.events = [
      {
        id: 'event-1',
        featureId: canonical.id,
        type: 'handoff_recorded',
        actorType: 'agent',
        payload: { messageId: 'message-product-design-orchestrator' },
        createdAt: canonical.updatedAt,
      },
    ];
    const progress = deriveFeatureWorkflowProgress(canonical, members, [
      message(DESIGN_READY, 'product-design', 'orchestrator'),
      forgedFuture,
    ]);
    expect(progress.map((item) => item.status)).toEqual([
      'completed',
      'active',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(progress[1]?.detail).toContain('design is reviewable');
  });

  it('projects aggregate blocked state onto only the current macro step', () => {
    expect(
      deriveFeatureWorkflowProgress(feature('verification', 'blocked'), members, []).map(
        (item) => item.status
      )
    ).toEqual(['completed', 'completed', 'completed', 'blocked', 'pending', 'pending']);
  });

  it('routes only through the current canonical owner', () => {
    const design = feature('design');
    const human = message('@orchestrator continue', 'you', 'orchestrator', 'text');
    expect(featureWorkflowAllowedTargetHandles(design, members, human)).toEqual(['orchestrator']);

    const delegate = message('@product-design work', 'orchestrator', 'product-design', 'text');
    expect(featureWorkflowAllowedTargetHandles(design, members, delegate)).toEqual([
      'product-design',
      'you',
    ]);

    const skipped = message('@engineering start', 'orchestrator', 'engineering', 'text');
    expect(featureWorkflowAllowedTargetHandles(design, members, skipped)).toEqual([
      'product-design',
      'you',
    ]);

    const report = message(DESIGN_READY, 'product-design', 'orchestrator');
    expect(featureWorkflowAllowedTargetHandles(design, members, report)).toEqual(['orchestrator']);

    const broadcast = { ...delegate, mentions: ['product-design', 'engineering'] };
    expect(featureWorkflowAllowedTargetHandles(design, members, broadcast)).toEqual([]);

    expect(
      featureWorkflowAllowedTargetHandles(feature('design', 'blocked'), members, delegate)
    ).toEqual(['you']);
    expect(
      featureWorkflowAllowedTargetHandles(
        feature('design', 'blocked'),
        members,
        message(DESIGN_READY, 'product-design', 'orchestrator')
      )
    ).toEqual([]);
  });

  it('accepts evidence only from the freshly hydrated stage owner and expected recipient', () => {
    const design = feature('design');
    expect(
      acceptedFeatureWorkflowStageSignal(
        design,
        members,
        message(DESIGN_READY, 'product-design', 'orchestrator')
      )
    ).toMatchObject({ stageId: 'product-design', verdict: 'ready' });
    expect(
      acceptedFeatureWorkflowStageSignal(
        design,
        members,
        message(DESIGN_READY, 'engineering', 'orchestrator')
      )
    ).toBeNull();
    expect(
      acceptedFeatureWorkflowStageSignal(
        feature('planning'),
        members,
        message(DESIGN_READY, 'product-design', 'orchestrator')
      )
    ).toBeNull();
    expect(
      acceptedFeatureWorkflowStageSignal(
        feature('design', 'cancelled'),
        members,
        message(DESIGN_READY, 'product-design', 'orchestrator')
      )
    ).toBeNull();
  });

  it('keeps the macro contract and canonical ownership mapping stable', () => {
    expect(FEATURE_WORKFLOW_STAGES.map((stage) => stage.id)).toEqual([
      'problem',
      'product-design',
      'implementation',
      'validation',
      'feature-docs',
      'launch-docs',
    ]);
    expect(featureWorkflowStageForFeatureStage('planning').handle).toBe('engineering');
    expect(featureWorkflowStageForFeatureStage('implementation').handle).toBe('engineering');
    expect(new Set(FEATURE_WORKFLOW_STAGES.map((stage) => stage.handle)).size).toBe(6);
  });
});
