import { countTeamMessages } from '@shared/team-protocol';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';

export type MemberSession = { projectId: string; taskId: string; conversationId: string };

type WaitOpts = { signal: AbortSignal; timeoutMs: number; pollMs: number };

export type MemberTurnOutcome =
  | { kind: 'aborted' }
  | { kind: 'done'; output: string; fresh: boolean };

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(finish, ms);
    const onAbort = () => finish();
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Resolve when the member finishes THIS turn. Primary signal is a fresh
 * `<<<YODA_TEAM_MSG>>>` block beyond `baselineCount` (independent of provider
 * run-state, so it works for codex which never reports terminal). Secondary:
 * the session returning to a terminal state after running, then the watchdog.
 * Same shape as review's `waitForReviewResult`; consolidated in Phase 4.
 */
export async function waitForMemberTurn(
  session: MemberSession,
  sessionId: string,
  baselineCount: number,
  opts: WaitOpts
): Promise<MemberTurnOutcome> {
  const start = Date.now();
  let sawRunning = agentSessionRuntimeStore.isRunning(session);
  for (;;) {
    if (opts.signal.aborted) return { kind: 'aborted' };
    const output = ptySessionRegistry.snapshot(sessionId);
    if (countTeamMessages(output) > baselineCount) return { kind: 'done', output, fresh: true };
    const running = agentSessionRuntimeStore.isRunning(session);
    if (running) sawRunning = true;
    else if (sawRunning) return { kind: 'done', output, fresh: false };
    if (Date.now() - start >= opts.timeoutMs) return { kind: 'done', output, fresh: false };
    await delay(opts.pollMs, opts.signal);
  }
}
