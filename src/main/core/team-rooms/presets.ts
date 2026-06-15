import type { RuntimeId } from '@shared/runtime-registry';
import { addMember, createRoom, postMessage } from './store';

/**
 * Room presets seed a room's members + initial routing. A preset is just a set
 * of members whose role system prompts encode the collaboration via @mentions —
 * the conductor stays generic. `review-loop` is the first one (implement ↔
 * review until the reviewer signs off).
 */

const IMPLEMENTER_ROLE_PROMPT = [
  `You are the implementer. Build what the lead asks for in this worktree.`,
  `When your implementation round is complete, hand off to @reviewer in your team message`,
  `(e.g. "@reviewer ready for review"). When the reviewer sends back fixes, address them and`,
  `hand back to @reviewer again. Keep the existing direction unless a fix requires otherwise.`,
].join('\n');

const REVIEWER_ROLE_PROMPT = [
  `You are the reviewer. Do not modify files — only inspect the worktree against the lead's`,
  `original requirement. In your team message: if it's not done, give @implementer the concrete`,
  `fixes and hand back to them; if it fully meets the requirement, say so and hand off to @you`,
  `(the lead) with a one-line PASS summary.`,
].join('\n');

export type SeedReviewRoomParams = {
  projectId: string;
  taskId: string;
  name: string;
  /** The lead's opening ask; posted as "@implementer <requirement>" to kick the loop. */
  requirement: string;
  implementer: { runtime: RuntimeId; systemPrompt?: string; autoApprove?: boolean };
  reviewer: { runtime: RuntimeId; systemPrompt?: string; autoApprove?: boolean };
};

/** Create a review-loop room (lead + implementer + reviewer) and kick it off. */
export async function seedReviewRoom(params: SeedReviewRoomParams): Promise<string> {
  const room = await createRoom({
    projectId: params.projectId,
    taskId: params.taskId,
    name: params.name,
    preset: 'review-loop',
  });

  const lead = await addMember({
    roomId: room.id,
    handle: 'you',
    displayName: 'You',
    role: 'lead',
    runtime: null,
    accent: 'terra',
  });
  await addMember({
    roomId: room.id,
    handle: 'implementer',
    displayName: 'Implementer',
    role: 'implementer',
    runtime: params.implementer.runtime,
    systemPrompt: joinRolePrompt(IMPLEMENTER_ROLE_PROMPT, params.implementer.systemPrompt),
    autoApprove: params.implementer.autoApprove ?? false,
    accent: 'amber',
  });
  await addMember({
    roomId: room.id,
    handle: 'reviewer',
    displayName: 'Reviewer',
    role: 'reviewer',
    runtime: params.reviewer.runtime,
    systemPrompt: joinRolePrompt(REVIEWER_ROLE_PROMPT, params.reviewer.systemPrompt),
    autoApprove: params.reviewer.autoApprove ?? false,
    accent: 'teal',
  });

  // Lead's opening message routes the first turn to the implementer.
  await postMessage({
    roomId: room.id,
    authorMemberId: lead.id,
    kind: 'text',
    body: `@implementer ${params.requirement}`,
  });

  return room.id;
}

function joinRolePrompt(base: string, extra?: string): string {
  return extra && extra.trim() ? `${base}\n\n${extra.trim()}` : base;
}
