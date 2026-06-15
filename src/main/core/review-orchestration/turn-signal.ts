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
 * Resolve with THIS round's reviewer verdict. Primary signal is a fresh
 * `YODA_REVIEW_RESULT` marker in the PTY output — independent of provider
 * run-state, so it works even when codex never writes `task_complete` and its
 * status stays pinned at `working`.
 *
 * Because the reviewer reuses one session across rounds, its buffer still holds
 * the previous round's marker; `baselineMarkerCount` is the marker count taken
 * right before this round's request was sent, so a verdict only counts once the
 * total exceeds it. Secondary signals (session returning to a terminal state,
 * watchdog timeout) resolve as "no fresh verdict" → not passed → another round.
 */
export async function waitForReviewResult(
  session: SessionKey,
  sessionId: string,
  baselineMarkerCount: number,
  opts: WaitOpts
): Promise<ReviewTurnOutcome> {
  const start = Date.now();
  const noVerdict = (result: ReviewResult): ReviewTurnOutcome => ({
    kind: 'result',
    result: { ...result, passed: false, hasMarker: false },
  });
  let sawRunning = agentSessionRuntimeStore.isRunning(session);
  for (;;) {
    if (opts.signal.aborted) return { kind: 'aborted' };
    const result = parseReviewResult(ptySessionRegistry.snapshot(sessionId));
    if (result.markerCount > baselineMarkerCount) return { kind: 'result', result };
    const running = agentSessionRuntimeStore.isRunning(session);
    if (running) sawRunning = true;
    else if (sawRunning) return noVerdict(result);
    if (Date.now() - start >= opts.timeoutMs) return noVerdict(result);
    await delay(opts.pollMs, opts.signal);
  }
}
