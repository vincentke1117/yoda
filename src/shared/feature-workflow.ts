import { z } from 'zod';
import { TEAM_AT_SCRIPT } from './agent-communication-protocol';
import {
  featureArtifactTypeSchema,
  featureStageIds,
  type Feature,
  type FeatureArtifactType,
  type FeatureStageId,
} from './features';
import type { RoomMember, RoomMessage } from './team-room';

/** Stable identity for the built-in end-to-end feature-development team. */
export const BUILTIN_FEATURE_TEAM_ID = 'builtin:feature';

/** Stored on Team Rooms so the renderer can show the feature-specific workflow UI. */
export const FEATURE_WORKFLOW_ROOM_PRESET = 'feature-workflow' as const;

export const FEATURE_WORKFLOW_STAGES = [
  { id: 'problem', handle: 'orchestrator', number: '01', featureStages: ['problem'] },
  { id: 'product-design', handle: 'product-design', number: '02', featureStages: ['design'] },
  {
    id: 'implementation',
    handle: 'engineering',
    number: '03',
    featureStages: ['planning', 'implementation'],
  },
  { id: 'validation', handle: 'quality', number: '04', featureStages: ['verification'] },
  { id: 'feature-docs', handle: 'feature-docs', number: '05', featureStages: ['documentation'] },
  {
    id: 'launch-docs',
    handle: 'launch-docs',
    number: '06',
    featureStages: ['release', 'done'],
  },
] as const;

export type FeatureWorkflowStageId = (typeof FEATURE_WORKFLOW_STAGES)[number]['id'];
export type FeatureWorkflowGateVerdict = 'ready' | 'blocked';

export type FeatureWorkflowArtifactProposal = {
  type: FeatureArtifactType;
  title: string;
  uri: string;
  contentHash?: string | null;
};

export type FeatureWorkflowStageSignal = {
  stageId: FeatureWorkflowStageId;
  verdict: FeatureWorkflowGateVerdict;
  detail: string;
  artifacts: FeatureWorkflowArtifactProposal[];
  evidence: string;
  summary: string;
  blocker: string;
  needed: string;
};

export type FeatureWorkflowStageStatus = 'pending' | 'active' | 'completed' | 'blocked';

export type FeatureWorkflowStageProgress = {
  stage: (typeof FEATURE_WORKFLOW_STAGES)[number];
  status: FeatureWorkflowStageStatus;
  detail: string;
  member: RoomMember | null;
};

const STAGE_IDS = new Set<string>(FEATURE_WORKFLOW_STAGES.map((stage) => stage.id));
const FEATURE_SIGNAL_RE = /^\s*\[FEATURE:([a-z-]+):(ready|blocked)\]\s*([\s\S]+?)\s*$/i;
const artifactProposalSchema = z.object({
  type: featureArtifactTypeSchema,
  title: z.string().trim().min(1).max(240),
  uri: z.string().trim().min(1).max(4_000),
  contentHash: z.string().trim().max(256).nullable().optional(),
});
const readyPayloadSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  evidence: z.string().trim().min(1).max(8_000),
  artifacts: z.array(artifactProposalSchema).max(20).default([]),
  risks: z.string().trim().max(4_000).optional(),
});
const blockedPayloadSchema = z.object({
  blocker: z.string().trim().min(1).max(4_000),
  needed: z.string().trim().min(1).max(4_000),
  evidence: z.string().trim().max(8_000).optional(),
});

/**
 * Parse the machine-readable evidence envelope that Feature agents put in Team
 * Room hand-offs. A `ready` hand-off proposes draft evidence; it never approves
 * an artifact or advances the authoritative Feature gate.
 */
export function parseFeatureWorkflowStageSignal(body: string): FeatureWorkflowStageSignal | null {
  const match = FEATURE_SIGNAL_RE.exec(body);
  if (!match) return null;
  const stageId = match[1]?.toLowerCase();
  const verdict = match[2]?.toLowerCase();
  const payload = match[3];
  if (!stageId || !STAGE_IDS.has(stageId)) return null;
  if ((verdict !== 'ready' && verdict !== 'blocked') || !payload) return null;
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  if (verdict === 'ready') {
    const parsed = readyPayloadSchema.safeParse(json);
    if (!parsed.success) return null;
    return {
      stageId: stageId as FeatureWorkflowStageId,
      verdict,
      detail: `${parsed.data.summary} · ${parsed.data.evidence}`,
      artifacts: parsed.data.artifacts,
      evidence: parsed.data.evidence,
      summary: parsed.data.summary,
      blocker: '',
      needed: '',
    };
  }
  const parsed = blockedPayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  return {
    stageId: stageId as FeatureWorkflowStageId,
    verdict,
    detail: `${parsed.data.blocker} · ${parsed.data.needed}`,
    artifacts: [],
    evidence: parsed.data.evidence ?? '',
    summary: '',
    blocker: parsed.data.blocker,
    needed: parsed.data.needed,
  };
}

/**
 * Map the durable eight-stage aggregate into the six user-facing SOP steps. The
 * aggregate alone decides status; Room messages provide only the latest detail.
 */
export function deriveFeatureWorkflowProgress(
  feature: Feature,
  members: RoomMember[],
  messages: RoomMessage[]
): FeatureWorkflowStageProgress[] {
  const memberById = new Map(members.map((member) => [member.id, member]));
  const acceptedMessageIds = new Set(
    feature.events
      .map((event) => event.payload.messageId)
      .filter((messageId): messageId is string => typeof messageId === 'string')
  );
  const latestDetail = new Map<FeatureWorkflowStageId, string>();
  for (const message of messages) {
    if (message.kind !== 'handoff' || !acceptedMessageIds.has(message.id)) continue;
    const signal = parseFeatureWorkflowStageSignal(message.body);
    if (!signal) continue;
    const stage = FEATURE_WORKFLOW_STAGES.find((candidate) => candidate.id === signal.stageId);
    const author = message.authorMemberId ? memberById.get(message.authorMemberId) : null;
    if (stage && author?.handle === stage.handle) latestDetail.set(signal.stageId, signal.detail);
  }

  const memberByHandle = new Map(members.map((member) => [member.handle, member]));
  const currentIndex = featureStageIds.indexOf(feature.stage);
  return FEATURE_WORKFLOW_STAGES.map((stage) => {
    const stageIndexes = stage.featureStages.map((id) => featureStageIds.indexOf(id));
    const min = Math.min(...stageIndexes);
    const max = Math.max(...stageIndexes);
    let status: FeatureWorkflowStageStatus;
    if (feature.status === 'completed' || currentIndex > max) status = 'completed';
    else if (currentIndex < min) status = 'pending';
    else if (feature.status === 'blocked' || feature.status === 'cancelled') status = 'blocked';
    else status = 'active';
    return {
      stage,
      status,
      detail: latestDetail.get(stage.id) ?? '',
      member: memberByHandle.get(stage.handle) ?? null,
    };
  });
}

export function featureWorkflowStageForFeatureStage(
  stageId: FeatureStageId
): (typeof FEATURE_WORKFLOW_STAGES)[number] {
  const stage = FEATURE_WORKFLOW_STAGES.find((candidate) =>
    (candidate.featureStages as readonly FeatureStageId[]).includes(stageId)
  );
  if (!stage) throw new Error(`Unsupported Feature stage: ${stageId}`);
  return stage;
}

/**
 * Runtime routing guard for Feature rooms. Freshly hydrated aggregate state is
 * authoritative: the lead may reach only the current owner or human, and a
 * worker may report only while it owns the current stage.
 */
export function featureWorkflowAllowedTargetHandles(
  feature: Feature,
  members: RoomMember[],
  message: RoomMessage
): string[] {
  // A Feature hand-off is deliberately singular. Reject broadcasts and any
  // multi-target message even when every named stage has been unlocked.
  if (message.mentions.length !== 1 || message.mentions.includes('all')) return [];
  const author = message.authorMemberId
    ? members.find((member) => member.id === message.authorMemberId)
    : null;
  if (!author) return [];

  if (!author.runtime) {
    return ['orchestrator'];
  }

  const owner = featureWorkflowStageForFeatureStage(feature.stage).handle;
  if (feature.status !== 'active') {
    return author.handle === 'orchestrator' ? ['you'] : [];
  }
  if (author.handle === 'orchestrator') {
    return owner === 'orchestrator' ? ['you'] : [owner, 'you'];
  }
  return author.handle === owner ? ['orchestrator'] : [];
}

/** A hand-off is ingestible only when it comes from the authoritative stage owner. */
export function acceptedFeatureWorkflowStageSignal(
  feature: Feature,
  members: RoomMember[],
  message: RoomMessage
): FeatureWorkflowStageSignal | null {
  if (feature.status !== 'active') return null;
  if (message.kind !== 'handoff' || message.mentions.length !== 1) return null;
  const signal = parseFeatureWorkflowStageSignal(message.body);
  if (!signal) return null;
  const workflowStage = featureWorkflowStageForFeatureStage(feature.stage);
  if (signal.stageId !== workflowStage.id) return null;
  const author = message.authorMemberId
    ? members.find((member) => member.id === message.authorMemberId)
    : null;
  if (author?.handle !== workflowStage.handle) return null;
  const expectedRecipient = workflowStage.id === 'problem' ? 'you' : 'orchestrator';
  return message.mentions[0] === expectedRecipient ? signal : null;
}

/** Recognize built-in Feature and editable duplicates without storing new DB metadata. */
export function hasFeatureWorkflowContract(team: {
  routing: string;
  members: ReadonlyArray<{ handle: string; role: string }>;
}): boolean {
  if (team.routing !== 'sequential') return false;
  return (
    team.members.length === FEATURE_WORKFLOW_STAGES.length &&
    FEATURE_WORKFLOW_STAGES.every(
      (stage, index) =>
        team.members[index]?.handle === stage.handle &&
        team.members[index]?.role === (index === 0 ? 'leader' : 'worker')
    )
  );
}

const SHARED_WORKER_RULES = [
  `Read the repository's own instructions before acting. Reuse its conventions and existing abstractions.`,
  `Read every artifact produced by earlier stages; those artifacts are your input contract.`,
  `Keep the worktree usable for the next teammate. Do not discard or overwrite another member's work.`,
  `Report repository-relative artifact paths and exact evidence in one machine-readable hand-off. Never claim a check passed unless you ran it.`,
  `A ready hand-off only proposes draft evidence. It does not approve an artifact or advance the Feature gate.`,
  `If you cannot satisfy the current stage, report a blocked envelope with the exact blocker instead of skipping ahead.`,
].join('\n');

export const FEATURE_LEAD_PROMPT = [
  `You are the Feature Lead for a governed, evidence-backed Feature delivery workflow.`,
  `The project Feature workspace is the only source of truth for stage, status, artifacts, and gates. Team Room messages never advance it.`,
  `You coordinate the team; you do not implement production code or author downstream artifacts yourself.`,
  ``,
  `# Canonical sequence`,
  `Problem (you) → Product/UX design (@product-design) → Technical plan (@engineering) → Implementation (@engineering) → Verification (@quality) → Feature docs (@feature-docs) → Release/PR/SEO (@launch-docs) → Done.`,
  `Planning and implementation are two separate governed stages owned by the same engineering teammate. Never collapse their approvals.`,
  ``,
  `# Governed hand-off protocol`,
  `Work only on the stage named in the latest human continuation message. Delegate exactly one current-stage owner and wait; never fan out future work.`,
  `For the Problem stage, write the problem contract in repository-native docs, then run:`,
  `${TEAM_AT_SCRIPT} you '[FEATURE:problem:ready] {"summary":"problem contract is reviewable","evidence":"artifact path and success signal","artifacts":[]}'`,
  `If a material decision is missing, run:`,
  `${TEAM_AT_SCRIPT} you '[FEATURE:problem:blocked] {"blocker":"missing decision","needed":"specific human answer"}'`,
  `Workers report ready/blocked envelopes to you. Inspect their actual files and evidence. If incomplete, reassign the same current owner. If reviewable, tell the human which draft artifacts to approve and ask them to advance the Feature workspace gate.`,
  `After the human advances or retreats the Feature workspace, they will continue the Room with the new canonical stage. Do not infer a transition from old messages.`,
  `A failed verification requires the human to retreat the Feature to Implementation before you may route engineering again.`,
  `An N/A release or SEO result still needs a real artifact explaining why; it is never represented by a missing artifact.`,
  `At Done, audit the Feature workspace and report a compact completion packet to the human.`,
  `Do not push, merge, publish, or create external resources unless the user's request or repository instructions authorize that action.`,
].join('\n');

export const FEATURE_PRODUCT_DESIGN_PROMPT = [
  `You own stage 02, Product Design. Do not implement production code.`,
  `Turn the problem contract into a decision-ready product and UI/UX specification. Inspect the existing product so the design fits its real interaction language.`,
  `Prefer the repository's existing plan/docs convention; if none exists, use docs/features/<feature-slug>/design.md.`,
  `Cover the problem and target user, goals/non-goals, end-to-end flow, information architecture, UI states, responsive/accessibility behavior, technical constraints, testable acceptance criteria, edge cases, and unresolved decisions.`,
  SHARED_WORKER_RULES,
  `A ready payload must propose product_spec, ux_design, and acceptance_criteria artifacts (they may share one URI when one document contains all three):`,
  `${TEAM_AT_SCRIPT} orchestrator '[FEATURE:product-design:ready] {"summary":"design is reviewable","evidence":"key decisions and checks","artifacts":[{"type":"product_spec","title":"Product specification","uri":"docs/features/<slug>/design.md"},{"type":"ux_design","title":"UX design","uri":"docs/features/<slug>/design.md"},{"type":"acceptance_criteria","title":"Acceptance criteria","uri":"docs/features/<slug>/design.md"}]}'`,
  `If blocked: ${TEAM_AT_SCRIPT} orchestrator '[FEATURE:product-design:blocked] {"blocker":"specific issue","needed":"decision or input"}'`,
  `After the hand-off, stop.`,
].join('\n');

export const FEATURE_ENGINEERING_PROMPT = [
  `You own both Technical Planning and Implementation, but they are separate canonical stages. Obey the stage named by the lead.`,
  `During Planning, inspect the approved design and write a repository-native technical plan covering architecture, dependencies, risks, rollout, and test strategy. Do not implement production code.`,
  `During Implementation, start only from the approved technical plan. Implement the smallest coherent change satisfying the acceptance criteria, including focused tests.`,
  `Run relevant focused checks before the Implementation hand-off; independent full validation belongs to @quality.`,
  SHARED_WORKER_RULES,
  `Planning ready: ${TEAM_AT_SCRIPT} orchestrator '[FEATURE:implementation:ready] {"summary":"technical plan is reviewable","evidence":"architecture and test strategy covered","artifacts":[{"type":"technical_plan","title":"Technical plan","uri":"docs/plans/<feature>.md"}]}'`,
  `Implementation ready: ${TEAM_AT_SCRIPT} orchestrator '[FEATURE:implementation:ready] {"summary":"implementation is ready for review","evidence":"exact focused commands and results","artifacts":[]}'`,
  `If blocked: ${TEAM_AT_SCRIPT} orchestrator '[FEATURE:implementation:blocked] {"blocker":"specific issue","needed":"next action"}'`,
  `After the hand-off, stop.`,
].join('\n');

export const FEATURE_QUALITY_PROMPT = [
  `You own stage 04, Validation. Act as an independent verifier and do not repair production code yourself.`,
  `Review the actual diff against the problem contract and approved acceptance criteria. Check regressions, edge cases, accessibility where applicable, tests, docs impact, and repository-specific required commands.`,
  `Run the required checks from the repository instructions and write a durable validation report with exact commands/results.`,
  SHARED_WORKER_RULES,
  `On success: ${TEAM_AT_SCRIPT} orchestrator '[FEATURE:validation:ready] {"summary":"verification passed","evidence":"exact commands, results, coverage, and risks","artifacts":[{"type":"test_evidence","title":"Validation report","uri":"docs/features/<slug>/validation.md"}]}'`,
  `On any defect: ${TEAM_AT_SCRIPT} orchestrator '[FEATURE:validation:blocked] {"blocker":"concrete findings","needed":"retreat to implementation, fix, and re-validate","evidence":"failed command or location"}'`,
  `After the hand-off, stop.`,
].join('\n');

export const FEATURE_DOCS_PROMPT = [
  `You own stage 05, Feature Documentation. Document verified behavior, not design intent.`,
  `Use the repository's existing user-docs structure. Cover what the feature does, who it is for, how to use/configure it, examples, UI states, limitations, troubleshooting, and migration/compatibility notes when relevant.`,
  `Link to the design artifact only as background; the feature document must stand on its own for a user. Run the docs build or validation command when one exists.`,
  SHARED_WORKER_RULES,
  `When ready: ${TEAM_AT_SCRIPT} orchestrator '[FEATURE:feature-docs:ready] {"summary":"user documentation is reviewable","evidence":"docs checks and journeys covered","artifacts":[{"type":"feature_docs","title":"Feature guide","uri":"docs/features/<slug>.md"}]}'`,
  `If blocked: ${TEAM_AT_SCRIPT} orchestrator '[FEATURE:feature-docs:blocked] {"blocker":"specific issue","needed":"next action"}'`,
  `After the hand-off, stop.`,
].join('\n');

export const FEATURE_LAUNCH_DOCS_PROMPT = [
  `You own stage 06, PR & SEO Documentation. Base every claim on the verified diff and validation evidence.`,
  `Follow existing PR/changelog/launch conventions. Prepare a reviewer-ready PR title and body (problem, solution, UX, test evidence, docs, risks, screenshots when relevant) plus changelog/release copy.`,
  `Prepare SEO title, meta description, target keywords, suggested slug, search intent, and announcement copy. When SEO is not applicable, the SEO artifact must record N/A and a concrete reason.`,
  `Prefer repository-native files/templates; otherwise use a launch packet beside the feature docs. Do not open or merge a PR unless explicitly authorized.`,
  SHARED_WORKER_RULES,
  `A ready payload must propose delivery_summary, pull_request, release_note, and seo artifacts (they may share one launch packet URI):`,
  `${TEAM_AT_SCRIPT} orchestrator '[FEATURE:launch-docs:ready] {"summary":"launch packet is reviewable","evidence":"claims checked against verified behavior","artifacts":[{"type":"delivery_summary","title":"Delivery summary","uri":"docs/features/<slug>/launch.md"},{"type":"pull_request","title":"Pull request packet","uri":"docs/features/<slug>/launch.md"},{"type":"release_note","title":"Release note","uri":"docs/features/<slug>/launch.md"},{"type":"seo","title":"SEO and announcement copy","uri":"docs/features/<slug>/launch.md"}]}'`,
  `If blocked: ${TEAM_AT_SCRIPT} orchestrator '[FEATURE:launch-docs:blocked] {"blocker":"specific issue","needed":"next action"}'`,
  `After the hand-off, stop.`,
].join('\n');
