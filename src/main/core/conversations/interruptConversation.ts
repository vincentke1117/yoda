import { ptyInputChannel } from '@shared/events/ptyEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { ok } from '@shared/result';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { markInterrupted } from './interrupt-marker';

interface AgentSessionKey {
  projectId: string;
  taskId: string;
  conversationId: string;
}

/** Esc — the interrupt key of the agent TUIs (Claude Code / Codex). */
const INTERRUPT_INPUT = '\x1b';

/**
 * How long the authoritative run-state sources get to confirm the interrupt. A
 * real interrupt lands in the transcript within ~100ms (interrupt sentinel /
 * turn_aborted) and flips the status through the normal pipeline. Hitting this
 * timeout means the session was stale-working — e.g. a turn killed by an app
 * restart leaves the transcript frozen mid-turn while the resumed CLI idles at
 * the prompt, so Esc has nothing to interrupt and no terminal row ever arrives.
 */
const CONFIRM_TIMEOUT_MS = 3_000;

/**
 * Interrupt a working agent session: send Esc to its PTY and, if no
 * authoritative source confirms a status change in time, force-clear the
 * status so a stale `working` can always be dismissed by the user. If the CLI
 * was genuinely working and ignored Esc, the next transcript-derived
 * transition re-asserts `working` — the force-clear is self-correcting.
 */
export function interruptConversation(projectId: string, taskId: string, conversationId: string) {
  const session = { projectId, taskId, conversationId };
  const pty = ptySessionRegistry.get(makePtySessionId(projectId, taskId, conversationId));
  if (!pty) {
    // No live CLI — nothing to interrupt; the `working` is stale by definition.
    markInterrupted(conversationId);
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'watchdog-idle', at: Date.now() },
      'interrupt:no-pty'
    );
    return ok();
  }
  pty.write(INTERRUPT_INPUT);
  scheduleInterruptReconcile(session);
  return ok();
}

/**
 * After an Esc was sent (or typed), give the authoritative sources
 * {@link CONFIRM_TIMEOUT_MS} to confirm; if the session is still `working`,
 * force-clear it. Self-correcting: a genuinely working CLI that ignored the
 * Esc re-asserts `working` on its next transcript-derived transition.
 */
function scheduleInterruptReconcile(session: AgentSessionKey): void {
  // Mark immediately: from this instant, transcript-`working` verdicts older
  // than the interrupt are stale and must not self-heal back into the store
  // (deriveStatus) or be re-asserted by the transcript tailer.
  markInterrupted(session.conversationId);
  setTimeout(() => {
    if (agentSessionRuntimeStore.getStatus(session) !== 'working') return;
    log.debug('interruptConversation: unconfirmed after timeout, force-clearing', session);
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'watchdog-idle', at: Date.now() },
      'interrupt:timeout'
    );
  }, CONFIRM_TIMEOUT_MS);
}

/**
 * Watch a session's PTY input stream for a bare Esc typed directly into the
 * terminal TUI while the session is `working`, and run the same reconciliation
 * as the stop button. Needed because an interrupt is not always observable in
 * the transcript: Esc before the first assistant output writes no interrupt
 * sentinel and fires no Stop hook, so the transcript stays frozen in a
 * `working` shape forever. A bare `\x1b` chunk is the Esc key itself — escape
 * sequences (arrows, etc.) arrive as multi-byte chunks and don't match.
 *
 * Returns a dispose function; call it when the PTY exits.
 */
export function attachEscInterruptReconciler(
  ptySessionId: string,
  session: AgentSessionKey
): () => void {
  return events.on(
    ptyInputChannel,
    (data) => {
      if (data !== INTERRUPT_INPUT) return;
      if (agentSessionRuntimeStore.getStatus(session) !== 'working') return;
      scheduleInterruptReconcile(session);
    },
    ptySessionId
  );
}
