import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { markInterrupted } from './interrupt-marker';

/**
 * Last-resort output-silence reconciler for agent sessions.
 *
 * Liveness invariant of the agent TUIs (Claude Code / Codex): while a turn is
 * running they continuously redraw a spinner / elapsed counter, so the PTY
 * produces output at ≥1 Hz. A session whose status claims `working` but whose
 * PTY has been silent for {@link SILENCE_THRESHOLD_MS} is probably NOT working.
 * The preferred Claude path is the session activity file
 * (`~/.claude/sessions/<pid>.json`) plus transcript cross-check; this reconciler
 * only catches gaps where a watcher was not attached or the process exited
 * before another source could report a terminal transition:
 *
 *  - Esc pressed before the first assistant output: CC writes no interrupt
 *    sentinel and fires no Stop hook, so the transcript freezes in a `working`
 *    shape if the session activity watcher is unavailable.
 *  - A turn killed by an app/CLI restart: the resumed CLI idles at the prompt
 *    while the transcript still looks mid-turn.
 *
 * Deliberately NOT keystroke detection — what the user pressed is decoupled
 * from what the session actually did; silence observes the effect, not the
 * input. Self-correcting: if the CLI is genuinely working (output resumes /
 * transcript rows land), the tailer re-asserts `working`.
 */
const SILENCE_THRESHOLD_MS = 10_000;
const SWEEP_INTERVAL_MS = 3_000;

interface AgentSessionKey {
  projectId: string;
  taskId: string;
  conversationId: string;
}

interface Entry {
  session: AgentSessionKey;
  lastOutputAt: number;
}

class AgentSilenceReconciler {
  private entries = new Map<string, Entry>();
  private timer: NodeJS.Timeout | null = null;

  /**
   * Track a live agent PTY. Call `noteOutput` from its onData; returns a
   * dispose function for PTY exit.
   */
  attach(ptySessionId: string, session: AgentSessionKey): () => void {
    this.entries.set(ptySessionId, { session, lastOutputAt: Date.now() });
    if (!this.timer) {
      this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
      this.timer.unref?.();
    }
    return () => {
      this.entries.delete(ptySessionId);
      if (this.entries.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  noteOutput(ptySessionId: string): void {
    const entry = this.entries.get(ptySessionId);
    if (entry) entry.lastOutputAt = Date.now();
  }

  /**
   * True when the session's PTY has been silent past the threshold — i.e. a
   * `working` status is stale and the CLI is actually idling at its prompt.
   */
  isStale(ptySessionId: string): boolean {
    const entry = this.entries.get(ptySessionId);
    if (!entry) return false;
    return Date.now() - entry.lastOutputAt > SILENCE_THRESHOLD_MS;
  }

  private sweep(): void {
    const now = Date.now();
    for (const { session, lastOutputAt } of this.entries.values()) {
      if (now - lastOutputAt <= SILENCE_THRESHOLD_MS) continue;
      if (agentSessionRuntimeStore.getStatus(session) !== 'working') continue;
      // Don't clear a turn that JUST started and hasn't produced output yet
      // (submit → working is set before the CLI echoes anything).
      if (now - agentSessionRuntimeStore.getState(session).updatedAt <= SILENCE_THRESHOLD_MS) {
        continue;
      }
      log.debug('AgentSilenceReconciler: working but silent, clearing', session);
      // Mark first so the stateless deriveStatus / transcript tailer can't
      // resurrect the zombie `working` from the frozen transcript.
      markInterrupted(session.conversationId);
      agentSessionRuntimeStore.dispatch(
        session,
        { kind: 'watchdog-idle', at: now },
        'silence:stale'
      );
    }
  }
}

export const agentSilenceReconciler = new AgentSilenceReconciler();
