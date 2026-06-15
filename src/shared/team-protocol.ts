import { stripTerminalControlSequences } from './prompt-format';

/**
 * Teammate chat protocol — the generic version of the review hand-off. An agent
 * member ends its turn with a short message to the room wrapped between these
 * two lines; the conductor forwards only that (never the raw terminal), and any
 * @handle inside it routes the next turn. Mirrors the `<<<YODA_REVIEW_NOTES>>>`
 * mechanism in review-protocol.ts.
 */
const MSG_OPEN = '<<<YODA_TEAM_MSG';
const MSG_CLOSE = 'YODA_TEAM_MSG>>>';
const MSG_PLACEHOLDER = '...your short message to the room — @mention a teammate to hand off...';
/** Fallback cap when the agent forgets the block. */
const FALLBACK_CHARS = 4_000;

export interface RosterEntry {
  handle: string;
  displayName: string;
  role: string;
}

/**
 * System-prompt fragment teaching an agent the room etiquette. Baked into the
 * member's conversation on its first turn (no system prompt re-sent after).
 */
export function buildTeammateSystemPrompt(args: {
  displayName: string;
  handle: string;
  roster: RosterEntry[];
}): string {
  const others = args.roster
    .filter((r) => r.handle !== args.handle)
    .map((r) => `@${r.handle} (${r.displayName} · ${r.role})`)
    .join(', ');
  return [
    `You are ${args.displayName} (@${args.handle}), a teammate in a shared chat room working in this worktree.`,
    others ? `Other teammates: ${others}. The human lead is @you.` : `The human lead is @you.`,
    '',
    `Etiquette:`,
    `- Do the work the latest message asks of you, using the tools in this worktree.`,
    `- When done, post a SHORT conclusion to the room — talk like a teammate in chat, not a full report, and don't paste your raw output back.`,
    `- Wrap that conclusion between these two lines, written exactly:`,
    `  ${MSG_OPEN}`,
    `  ${MSG_PLACEHOLDER}`,
    `  ${MSG_CLOSE}`,
    `- To hand work to a teammate, @mention their handle inside that block (e.g. "@reviewer please check").`,
    `- End your turn right after the closing line.`,
  ].join('\n');
}

/** The per-turn content injected when a member is addressed in the room. */
export function buildMemberTurnPrompt(args: { fromDisplayName: string; body: string }): string {
  return [
    `${args.fromDisplayName} in the room:`,
    args.body,
    '',
    `Reply with your work, then post your conclusion between the ${MSG_OPEN} … ${MSG_CLOSE} lines.`,
  ].join('\n');
}

/** Number of completed team-message blocks in the output (for per-turn baselining). */
export function countTeamMessages(output: string): number {
  const clean = stripTerminalControlSequences(output);
  let count = 0;
  let from = 0;
  for (;;) {
    const open = clean.indexOf(MSG_OPEN, from);
    if (open === -1) break;
    const close = clean.indexOf(MSG_CLOSE, open + MSG_OPEN.length);
    if (close === -1) break;
    count += 1;
    from = close + MSG_CLOSE.length;
  }
  return count;
}

/**
 * Pull the agent's latest hand-off message. Returns the last complete block's
 * inner text; null if there's no real one (placeholder echo or none) so the
 * caller can fall back to a bounded buffer tail.
 */
export function extractTeamMessage(output: string): string | null {
  const clean = stripTerminalControlSequences(output);
  const open = clean.lastIndexOf(MSG_OPEN);
  if (open === -1) return null;
  const afterOpen = open + MSG_OPEN.length;
  const close = clean.indexOf(MSG_CLOSE, afterOpen);
  if (close === -1) return null;
  const inner = clean.slice(afterOpen, close).trim();
  if (!inner || inner === MSG_PLACEHOLDER) return null;
  return inner;
}

/** Best-effort message body from a finished turn: the block, else a bounded tail. */
export function teamMessageOrFallback(output: string): string {
  const note = extractTeamMessage(output);
  if (note) return note;
  return stripTerminalControlSequences(output).trim().slice(-FALLBACK_CHARS);
}
