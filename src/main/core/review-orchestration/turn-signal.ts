import { parseReviewResult, type ReviewResult } from '@shared/review-protocol';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';

export type SessionKey = {
  projectId: string;
  taskId: string;
  conversationId: string;
};

type WaitOpts = {
  signal: AbortSignal;
  timeoutMs: number;
  pollMs: number;
  /**
   * If the session is never observed running within this window, assume its
   * turn already ended (e.g. it finished while the app was down). Only used by
   * the implementer waiter — the reviewer waiter keeps waiting for its marker.
   */
  graceMs: number;
};

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

export type ImplementerTurnOutcome = 'ended' | 'aborted' | 'timeout';

/**
 * Resolve when the implementer's current turn ends. Turn-end = the session was
 * observed running (working/awaiting-input) and then returned to a terminal
 * state. Falls back to `timeout` (watchdog) so a missed terminal event can't
 * hang the loop forever.
 */
export async function waitForImplementerTurnEnd(
  session: SessionKey,
  opts: WaitOpts
): Promise<ImplementerTurnOutcome> {
  const start = Date.now();
  let sawRunning = agentSessionRuntimeStore.isRunning(session);
  for (;;) {
    if (opts.signal.aborted) return 'aborted';
    const running = agentSessionRuntimeStore.isRunning(session);
    if (running) sawRunning = true;
    else if (sawRunning) return 'ended';
    const elapsed = Date.now() - start;
    if (!sawRunning && elapsed >= opts.graceMs) return 'ended';
    if (elapsed >= opts.timeoutMs) return 'timeout';
    await delay(opts.pollMs, opts.signal);
  }
}

export type ReviewTurnOutcome = { kind: 'aborted' } | { kind: 'result'; result: ReviewResult };

/**
 * Resolve with the reviewer's verdict. Primary signal is the
 * `YODA_REVIEW_RESULT` marker in the PTY output — this is independent of
 * provider run-state, so it works even when codex never writes `task_complete`
 * and its status stays pinned at `working`. Secondary signals: the session
 * returning to a terminal state after running, and the watchdog timeout. In
 * both fallbacks the current buffer is parsed best-effort (no marker → not
 * passed → the implementer gets another round).
 */
export async function waitForReviewResult(
  session: SessionKey,
  sessionId: string,
  opts: WaitOpts
): Promise<ReviewTurnOutcome> {
  const start = Date.now();
  let sawRunning = agentSessionRuntimeStore.isRunning(session);
  for (;;) {
    if (opts.signal.aborted) return { kind: 'aborted' };
    const result = parseReviewResult(ptySessionRegistry.snapshot(sessionId));
    if (result.hasMarker) return { kind: 'result', result };
    const running = agentSessionRuntimeStore.isRunning(session);
    if (running) sawRunning = true;
    else if (sawRunning) return { kind: 'result', result };
    if (Date.now() - start >= opts.timeoutMs) return { kind: 'result', result };
    await delay(opts.pollMs, opts.signal);
  }
}
