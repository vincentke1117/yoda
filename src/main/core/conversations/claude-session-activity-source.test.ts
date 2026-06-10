import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunStateEvent } from '@shared/events/agent-run-state';
import { encodeClaudeProjectDir } from '@main/core/session-title/claude-title-source';
import {
  getClaudeSessionActivity,
  hasClaudeLeafPrompt,
  parseClaudeSessionActivity,
  watchClaudeSessionActivity,
  type ClaudeSessionActivityWatcher,
} from './claude-session-activity-source';

const mocks = vi.hoisted(() => ({
  markInterrupted: vi.fn(),
}));

vi.mock('./interrupt-marker', () => ({
  markInterrupted: mocks.markInterrupted,
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

function jsonl(rows: Array<Record<string, unknown>>): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('parseClaudeSessionActivity', () => {
  it('parses Claude session activity files', () => {
    expect(
      parseClaudeSessionActivity(
        JSON.stringify({
          pid: 123,
          sessionId: 'conv-1',
          cwd: '/repo',
          status: 'busy',
          updatedAt: 1_781_115_179_335,
        })
      )
    ).toEqual({
      pid: 123,
      sessionId: 'conv-1',
      cwd: '/repo',
      status: 'busy',
      waitingFor: null,
      updatedAt: 1_781_115_179_335,
    });
  });

  it('rejects unrelated JSON', () => {
    expect(parseClaudeSessionActivity('{}')).toBeNull();
    expect(
      parseClaudeSessionActivity(JSON.stringify({ sessionId: 'x', status: 'done' }))
    ).toBeNull();
  });
});

describe('hasClaudeLeafPrompt', () => {
  const user = {
    type: 'user',
    timestamp: '2026-06-11T00:00:01.000Z',
    message: { role: 'user', content: 'continue' },
  };
  const stop = { type: 'system', subtype: 'stop_hook_summary' };

  it('matches the early-Esc negative-space transcript shape', () => {
    expect(hasClaudeLeafPrompt(jsonl([stop, user, { type: 'mode' }]))).toBe(true);
  });

  it('does not treat synthetic assistant rows as meaningful output', () => {
    expect(
      hasClaudeLeafPrompt(
        jsonl([
          stop,
          user,
          { type: 'assistant', message: { role: 'assistant', content: [] } },
          { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking' }] } },
        ])
      )
    ).toBe(true);
  });

  it('rejects normal completion, assistant output, api errors, and interrupt sentinels', () => {
    expect(hasClaudeLeafPrompt(jsonl([stop, user, stop]))).toBe(false);
    expect(
      hasClaudeLeafPrompt(
        jsonl([user, { type: 'assistant', message: { role: 'assistant', content: 'ok' } }])
      )
    ).toBe(false);
    expect(hasClaudeLeafPrompt(jsonl([user, { type: 'system', subtype: 'api_error' }]))).toBe(
      false
    );
    expect(
      hasClaudeLeafPrompt(
        jsonl([
          user,
          {
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'text', text: '[Request interrupted by user]' }],
            },
          },
        ])
      )
    ).toBe(false);
  });
});

describe('watchClaudeSessionActivity', () => {
  let claudeHomeDir: string;
  let sessionsDir: string;
  let transcriptPath: string;
  let watcher: ClaudeSessionActivityWatcher | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    claudeHomeDir = mkdtempSync(join(tmpdir(), 'yoda-claude-activity-'));
    sessionsDir = join(claudeHomeDir, 'sessions');
    transcriptPath = join(
      claudeHomeDir,
      'projects',
      encodeClaudeProjectDir('/repo'),
      'conv-1.jsonl'
    );
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(join(claudeHomeDir, 'projects', encodeClaudeProjectDir('/repo')), {
      recursive: true,
    });
  });

  afterEach(() => {
    watcher?.stop();
    watcher = null;
    rmSync(claudeHomeDir, { recursive: true, force: true });
  });

  function writeTranscript(state: 'working' | 'idle'): void {
    const user = {
      type: 'user',
      timestamp: '2026-06-11T00:00:01.000Z',
      message: { role: 'user', content: 'continue' },
    };
    const stop = { type: 'system', subtype: 'stop_hook_summary' };
    writeFileSync(transcriptPath, jsonl(state === 'working' ? [stop, user] : [stop, user, stop]));
  }

  function writeTranscriptRows(rows: Array<Record<string, unknown>>): void {
    writeFileSync(transcriptPath, jsonl(rows));
  }

  function writeSession(
    status: 'busy' | 'idle' | 'waiting',
    updatedAt = Date.now(),
    overrides: { pid?: number; sessionId?: string; waitingFor?: string } = {}
  ): void {
    const pid = overrides.pid ?? 123;
    writeFileSync(
      join(sessionsDir, `${pid}.json`),
      JSON.stringify({
        pid,
        sessionId: overrides.sessionId ?? 'conv-1',
        cwd: '/repo',
        status,
        waitingFor:
          status === 'waiting' ? (overrides.waitingFor ?? 'approve AskUserQuestion') : undefined,
        updatedAt,
      })
    );
  }

  it('reads matching Claude session activity for session info', async () => {
    writeSession('busy', 1_781_115_179_335);

    await expect(
      getClaudeSessionActivity({
        cwd: '/repo',
        conversationId: 'conv-1',
        claudeHomeDir,
      })
    ).resolves.toEqual({
      pid: 123,
      sessionId: 'conv-1',
      cwd: '/repo',
      status: 'busy',
      waitingFor: null,
      updatedAt: 1_781_115_179_335,
    });
  });

  it('matches Claude activity by process pid when activity sessionId differs from Yoda conversation id', async () => {
    const events: RunStateEvent[] = [];
    writeTranscript('working');
    writeSession('busy', Date.now(), { pid: 456, sessionId: 'claude-session-id' });

    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', processPid: 456, claudeHomeDir, idleSettleMs: 10 },
      (event) => events.push(event)
    );

    await waitFor(() => events.some((event) => event.kind === 'turn-started'));
  });

  it('dispatches awaiting-input for Claude waiting on AskUserQuestion', async () => {
    const events: RunStateEvent[] = [];
    writeTranscript('working');
    writeSession('busy');

    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir, idleSettleMs: 10 },
      (event) => events.push(event)
    );

    await waitFor(() => events.some((event) => event.kind === 'turn-started'));
    writeSession('waiting', Date.now() + 1);

    await waitFor(() => events.some((event) => event.kind === 'awaiting-input'));
    const awaiting = events.find((event) => event.kind === 'awaiting-input');
    expect(awaiting).toMatchObject({
      kind: 'awaiting-input',
      pendingAction: {
        notificationType: 'elicitation_dialog',
        toolName: 'approve AskUserQuestion',
      },
    });
  });

  it('clears Claude waiting state when activity returns to busy', async () => {
    const events: RunStateEvent[] = [];
    writeTranscript('working');
    writeSession('waiting');

    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir, idleSettleMs: 10 },
      (event) => events.push(event)
    );

    await waitFor(() => events.some((event) => event.kind === 'awaiting-input'));
    writeSession('busy', Date.now() + 1);

    await waitFor(() =>
      events.some(
        (event) => event.kind === 'turn-started' && 'force' in event && event.force === true
      )
    );
  });

  it('clears Claude waiting state when activity goes waiting to idle before returning busy', async () => {
    const events: RunStateEvent[] = [];
    writeTranscript('working');
    writeSession('busy');

    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir, idleSettleMs: 10 },
      (event) => events.push(event)
    );

    await waitFor(() => events.some((event) => event.kind === 'turn-started'));
    writeSession('waiting', Date.now() + 1);

    await waitFor(() => events.some((event) => event.kind === 'awaiting-input'));
    writeSession('idle', Date.now() + 2);
    await new Promise((resolve) => setTimeout(resolve, 60));
    writeSession('busy', Date.now() + 3);

    await waitFor(() =>
      events.some(
        (event) => event.kind === 'turn-started' && 'force' in event && event.force === true
      )
    );
  });

  it('dispatches an interrupted turn for busy-to-idle with a transcript leaf prompt', async () => {
    const events: RunStateEvent[] = [];
    writeTranscript('working');
    writeSession('busy');

    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir, idleSettleMs: 10 },
      (event) => events.push(event)
    );

    await waitFor(() => events.some((event) => event.kind === 'turn-started'));
    writeSession('idle', Date.now() + 1);

    await waitFor(() => events.some((event) => event.kind === 'turn-interrupted'));
    expect(mocks.markInterrupted).toHaveBeenCalledWith('conv-1');
  });

  it('dispatches completed when busy-to-idle is backed by an idle transcript', async () => {
    const events: RunStateEvent[] = [];
    writeTranscript('working');
    writeSession('busy');

    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir, idleSettleMs: 10 },
      (event) => events.push(event)
    );

    await waitFor(() => events.some((event) => event.kind === 'turn-started'));
    writeTranscript('idle');
    writeSession('idle', Date.now() + 1);

    await waitFor(() => events.some((event) => event.kind === 'turn-completed'));
    expect(events.map((event) => event.kind)).toEqual(['turn-started', 'turn-completed']);
    expect(mocks.markInterrupted).not.toHaveBeenCalled();
  });

  it('dispatches completed for busy-to-idle with assistant output but no stop summary', async () => {
    const events: RunStateEvent[] = [];
    const user = {
      type: 'user',
      timestamp: '2026-06-11T00:00:01.000Z',
      message: { role: 'user', content: 'continue' },
    };
    const assistant = { type: 'assistant', message: { role: 'assistant', content: 'ok' } };
    const stop = { type: 'system', subtype: 'stop_hook_summary' };
    writeTranscriptRows([stop, user]);
    writeSession('busy');

    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir, idleSettleMs: 10 },
      (event) => events.push(event)
    );

    await waitFor(() => events.some((event) => event.kind === 'turn-started'));
    writeTranscriptRows([stop, user, assistant]);
    writeSession('idle', Date.now() + 1);

    await waitFor(() => events.some((event) => event.kind === 'turn-completed'));
    expect(events.map((event) => event.kind)).toEqual(['turn-started', 'turn-completed']);
    expect(mocks.markInterrupted).not.toHaveBeenCalled();
  });

  it('dispatches interrupted for busy-to-idle with an interrupt sentinel', async () => {
    const events: RunStateEvent[] = [];
    const user = {
      type: 'user',
      timestamp: '2026-06-11T00:00:01.000Z',
      message: { role: 'user', content: 'continue' },
    };
    const assistant = { type: 'assistant', message: { role: 'assistant', content: 'partial' } };
    const interrupt = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '[Request interrupted by user]' }],
      },
    };
    const stop = { type: 'system', subtype: 'stop_hook_summary' };
    writeTranscriptRows([stop, user, assistant]);
    writeSession('busy');

    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir, idleSettleMs: 10 },
      (event) => events.push(event)
    );

    await waitFor(() => events.some((event) => event.kind === 'turn-started'));
    writeTranscriptRows([stop, user, assistant, interrupt]);
    writeSession('idle', Date.now() + 1);

    await waitFor(() => events.some((event) => event.kind === 'turn-interrupted'));
    expect(events.map((event) => event.kind)).toEqual(['turn-started', 'turn-interrupted']);
    expect(mocks.markInterrupted).not.toHaveBeenCalled();
  });
});
