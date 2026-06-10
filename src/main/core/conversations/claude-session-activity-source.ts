import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PendingAction, RunStateEvent } from '@shared/events/agent-run-state';
import { encodeClaudeProjectDir } from '@main/core/session-title/claude-title-source';
import { log } from '@main/lib/logger';
import { iterateLines } from '@main/utils/text-lines';
import { classifyClaudeTranscriptVerdict } from './claude-run-state-source';
import { markInterrupted } from './interrupt-marker';

type ClaudeSessionStatus = 'busy' | 'idle' | 'waiting';

export interface ClaudeSessionActivity {
  pid: number | null;
  sessionId: string;
  cwd: string | null;
  status: ClaudeSessionStatus;
  waitingFor: string | null;
  updatedAt: number | null;
}

export interface ClaudeSessionActivityWatcher {
  stop(): void;
}

export interface ClaudeSessionActivityContext {
  cwd: string;
  conversationId: string;
  /** Local PTY process id. Claude activity sessionId is not always Yoda's conversation id. */
  processPid?: number;
  /** Test seam; production defaults to ~/.claude. */
  claudeHomeDir?: string;
  /** Test seam; production waits briefly for transcript writes to settle. */
  idleSettleMs?: number;
}

export type ClaudeSessionActivityDispatch = (event: RunStateEvent) => void;

const READY_POLL_INTERVAL_MS = 1_000;
const READY_POLL_MAX_MS = 5 * 60_000;
const IDLE_SETTLE_MS = 1_000;
const STALE_ACTIVITY_GRACE_MS = 5_000;
const PID_FILE_RE = /^\d+\.json$/;
const SESSION_STATUSES = new Set(['busy', 'idle', 'waiting']);
const INTERRUPT_SENTINELS = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
]);

/**
 * Watches Claude Code's process activity files (`~/.claude/sessions/<pid>.json`).
 *
 * Early Esc is invisible to hooks and to the transcript: Claude writes the user
 * prompt, flips its process status `busy -> idle`, then auto-restores the prompt
 * in the TUI before any assistant row or interrupt sentinel lands. The activity
 * file is therefore the only real-time positive signal; the transcript is used
 * as a cross-check so a normal completed turn is not treated as an interrupt.
 */
export function watchClaudeSessionActivity(
  ctx: ClaudeSessionActivityContext,
  dispatch: ClaudeSessionActivityDispatch
): ClaudeSessionActivityWatcher {
  return new ClaudeSessionActivityTailer(ctx, dispatch);
}

export function parseClaudeSessionActivity(raw: string): ClaudeSessionActivity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.sessionId !== 'string') return null;
  if (typeof rec.status !== 'string' || !SESSION_STATUSES.has(rec.status)) return null;
  return {
    pid: typeof rec.pid === 'number' ? rec.pid : null,
    sessionId: rec.sessionId,
    cwd: typeof rec.cwd === 'string' ? rec.cwd : null,
    status: rec.status as ClaudeSessionStatus,
    waitingFor: typeof rec.waitingFor === 'string' ? rec.waitingFor : null,
    updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : null,
  };
}

export async function getClaudeSessionActivity({
  cwd,
  conversationId,
  processPid,
  claudeHomeDir,
}: {
  cwd: string;
  conversationId: string;
  processPid?: number;
  claudeHomeDir?: string;
}): Promise<ClaudeSessionActivity | null> {
  const sessionsDir = join(claudeHomeDir ?? join(homedir(), '.claude'), 'sessions');
  return findMatchingActivity({ sessionsDir, cwd, conversationId, processPid, minUpdatedAt: null });
}

export function hasClaudeLeafPrompt(raw: string): boolean {
  let lastUserIdx = -1;
  let lastStopIdx = -1;
  let hasMeaningfulAfterLastUser = false;
  let idx = -1;

  for (const line of iterateLines(raw)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    idx += 1;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (row.subtype === 'stop_hook_summary') {
      lastStopIdx = idx;
      hasMeaningfulAfterLastUser = lastUserIdx !== -1;
      continue;
    }

    const message = row.message;
    const content =
      typeof message === 'object' && message !== null
        ? (message as Record<string, unknown>).content
        : undefined;

    if (row.type === 'user' && isUserMessage(message)) {
      if (isInterruptContent(content)) {
        lastStopIdx = idx;
        hasMeaningfulAfterLastUser = lastUserIdx !== -1;
        continue;
      }
      lastUserIdx = idx;
      hasMeaningfulAfterLastUser = false;
      continue;
    }

    if (lastUserIdx !== -1 && isMeaningfulPostPromptRow(row)) {
      hasMeaningfulAfterLastUser = true;
    }
  }

  return lastUserIdx > lastStopIdx && !hasMeaningfulAfterLastUser;
}

class ClaudeSessionActivityTailer implements ClaudeSessionActivityWatcher {
  private readonly claudeHomeDir: string;
  private readonly sessionsDir: string;
  private readonly transcriptPath: string;
  private readonly idleSettleMs: number;
  private readonly minUpdatedAt = Date.now() - STALE_ACTIVITY_GRACE_MS;
  private readonly readyDeadline = Date.now() + READY_POLL_MAX_MS;
  private watcher: FSWatcher | undefined;
  private readyTimer: NodeJS.Timeout | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private awaitingInputObserved = false;
  private reading = false;
  private pendingRead = false;
  private stopped = false;
  private lastActivity: Pick<ClaudeSessionActivity, 'status' | 'waitingFor' | 'updatedAt'> | null =
    null;

  constructor(
    private readonly ctx: ClaudeSessionActivityContext,
    private readonly dispatch: ClaudeSessionActivityDispatch
  ) {
    this.claudeHomeDir = ctx.claudeHomeDir ?? join(homedir(), '.claude');
    this.sessionsDir = join(this.claudeHomeDir, 'sessions');
    this.transcriptPath = join(
      this.claudeHomeDir,
      'projects',
      encodeClaudeProjectDir(ctx.cwd),
      `${ctx.conversationId}.jsonl`
    );
    this.idleSettleMs = ctx.idleSettleMs ?? IDLE_SETTLE_MS;
    this.waitForDirectory();
  }

  stop(): void {
    this.stopped = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    try {
      this.watcher?.close();
    } catch {}
    this.watcher = undefined;
  }

  private waitForDirectory(): void {
    if (this.stopped) return;
    stat(this.sessionsDir)
      .then((stats) => {
        if (!stats.isDirectory()) return;
        this.attach();
      })
      .catch(() => {
        if (this.stopped || Date.now() > this.readyDeadline) return;
        this.readyTimer = setTimeout(() => this.waitForDirectory(), READY_POLL_INTERVAL_MS);
      });
  }

  private attach(): void {
    if (this.stopped) return;
    try {
      this.watcher = watch(this.sessionsDir, () => this.scheduleRead());
      this.watcher.on('error', (err) => {
        log.warn('ClaudeSessionActivitySource: watch error', {
          sessionsDir: this.sessionsDir,
          error: String(err),
        });
      });
    } catch (err) {
      log.warn('ClaudeSessionActivitySource: failed to attach watcher', {
        sessionsDir: this.sessionsDir,
        error: String(err),
      });
      return;
    }
    this.scheduleRead();
  }

  private scheduleRead(): void {
    if (this.stopped) return;
    if (this.reading) {
      this.pendingRead = true;
      return;
    }
    this.reading = true;
    void this.inspect()
      .catch((err) => {
        log.warn('ClaudeSessionActivitySource: read error', {
          sessionsDir: this.sessionsDir,
          conversationId: this.ctx.conversationId,
          error: String(err),
        });
      })
      .finally(() => {
        this.reading = false;
        if (this.pendingRead && !this.stopped) {
          this.pendingRead = false;
          this.scheduleRead();
        }
      });
  }

  private async inspect(): Promise<void> {
    const activity = await findMatchingActivity({
      sessionsDir: this.sessionsDir,
      cwd: this.ctx.cwd,
      conversationId: this.ctx.conversationId,
      processPid: this.ctx.processPid,
      minUpdatedAt: this.minUpdatedAt,
    });
    if (!activity || this.stopped) return;
    if (this.lastActivity && sameActivity(this.lastActivity, activity)) return;

    const previous = this.lastActivity;
    this.lastActivity = {
      status: activity.status,
      waitingFor: activity.waitingFor,
      updatedAt: activity.updatedAt,
    };

    if (activity.status === 'waiting') {
      this.awaitingInputObserved = true;
      this.dispatch({
        kind: 'awaiting-input',
        at: Date.now(),
        pendingAction: pendingActionForWaitingFor(activity.waitingFor),
      });
      return;
    }

    if (activity.status === 'busy' && previous?.status !== 'busy') {
      const force = this.awaitingInputObserved || previous?.status === 'waiting';
      this.awaitingInputObserved = false;
      this.dispatch({
        kind: 'turn-started',
        at: Date.now(),
        force,
      });
      return;
    }

    if (previous?.status === 'busy' && activity.status === 'idle') {
      this.scheduleIdleReconcile(activity.updatedAt);
    }
  }

  private scheduleIdleReconcile(updatedAt: number | null): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      void this.reconcileIdle(updatedAt).catch((err) => {
        log.warn('ClaudeSessionActivitySource: idle reconcile failed', {
          conversationId: this.ctx.conversationId,
          error: String(err),
        });
      });
    }, this.idleSettleMs);
  }

  private async reconcileIdle(updatedAt: number | null): Promise<void> {
    if (this.stopped) return;
    if (!this.lastActivity || this.lastActivity.status !== 'idle') return;
    if (this.lastActivity.updatedAt !== updatedAt) return;

    const raw = await readFile(this.transcriptPath, 'utf8').catch(() => null);
    if (!raw) return;

    if (hasClaudeLeafPrompt(raw)) {
      // Claude says the process is idle, but the transcript still has the last
      // prompt as a leaf. That is the early-Esc negative-space signature.
      markInterrupted(this.ctx.conversationId);
      this.dispatch({ kind: 'turn-interrupted', at: Date.now() });
      return;
    }

    const verdict = classifyClaudeTranscriptVerdict(raw);
    if (verdict.state === 'awaiting-input') {
      this.dispatch({
        kind: 'awaiting-input',
        at: Date.now(),
        pendingAction: { notificationType: 'elicitation_dialog' },
      });
      return;
    }
    if (verdict.interrupted) {
      this.dispatch({ kind: 'turn-interrupted', at: Date.now() });
      return;
    }
    // A busy -> idle process transition is Claude Code's own lifecycle signal.
    // If the transcript is not the early-Esc negative space and not an interrupt
    // sentinel, treat it as a completed turn. This also covers missed Stop hook /
    // missing stop_hook_summary cases where assistant output exists but the
    // transcript-only classifier would otherwise stay `working`.
    this.dispatch({ kind: 'turn-completed', at: Date.now() });
  }
}

async function findMatchingActivity({
  sessionsDir,
  cwd,
  conversationId,
  processPid,
  minUpdatedAt,
}: {
  sessionsDir: string;
  cwd: string;
  conversationId: string;
  processPid?: number;
  minUpdatedAt: number | null;
}): Promise<ClaudeSessionActivity | null> {
  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return null;
  }

  const activities = await Promise.all(
    files
      .filter((file) => PID_FILE_RE.test(file))
      .map(async (file) => {
        const raw = await readFile(join(sessionsDir, file), 'utf8').catch(() => undefined);
        return raw ? parseClaudeSessionActivity(raw) : null;
      })
  );
  const candidates = activities
    .filter((activity): activity is ClaudeSessionActivity => {
      if (!activity) return false;
      if (minUpdatedAt !== null && activity.updatedAt !== null && activity.updatedAt < minUpdatedAt)
        return false;
      return activity.cwd === null || activity.cwd === cwd;
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  if (processPid !== undefined) {
    const pidMatch = candidates.find((activity) => activity.pid === processPid);
    if (pidMatch) return pidMatch;
  }

  return candidates.find((activity) => activity.sessionId === conversationId) ?? null;
}

function sameActivity(
  previous: Pick<ClaudeSessionActivity, 'status' | 'waitingFor' | 'updatedAt'>,
  next: Pick<ClaudeSessionActivity, 'status' | 'waitingFor' | 'updatedAt'>
): boolean {
  return (
    previous.status === next.status &&
    previous.waitingFor === next.waitingFor &&
    previous.updatedAt === next.updatedAt
  );
}

function pendingActionForWaitingFor(waitingFor: string | null): PendingAction {
  if (/\b(AskUserQuestion|ExitPlanMode|question|elicitation)\b/i.test(waitingFor ?? '')) {
    return {
      notificationType: 'elicitation_dialog',
      toolName: waitingFor ?? undefined,
      actionDescription: waitingFor ?? undefined,
    };
  }
  if (/(approve|permission)/i.test(waitingFor ?? '')) {
    return {
      notificationType: 'permission_prompt',
      toolName: waitingFor ?? undefined,
      actionDescription: waitingFor ?? undefined,
    };
  }
  return {
    notificationType: 'idle_prompt',
    actionDescription: waitingFor ?? undefined,
  };
}

function isUserMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Record<string, unknown>).role === 'user'
  );
}

function isInterruptContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>).type === 'text' &&
      INTERRUPT_SENTINELS.has((item as Record<string, unknown>).text as string)
  );
}

function isMeaningfulPostPromptRow(row: Record<string, unknown>): boolean {
  if (row.subtype === 'api_error') return true;
  if (row.type !== 'assistant') return false;
  const message = row.message;
  const content =
    typeof message === 'object' && message !== null
      ? (message as Record<string, unknown>).content
      : undefined;
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const block = item as Record<string, unknown>;
    if (block.type === 'tool_use') return true;
    return block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '';
  });
}
