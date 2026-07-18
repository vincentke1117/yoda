import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunState } from '@shared/events/agent-run-state';
import { AiLabAppBuildRunner } from './app-build-runner';
import { AiLabAppStore } from './app-store';
import { AiLabBuildJobStore } from './build-job-store';

const mocks = vi.hoisted(() => ({
  listener: null as ((state: RunState) => void) | null,
  emit: vi.fn(),
}));

vi.mock('@main/core/conversations/agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    subscribe: vi.fn((_session, listener: (state: RunState) => void) => {
      mocks.listener = listener;
      return vi.fn();
    }),
    getStatus: vi.fn(() => 'idle'),
  },
}));
vi.mock('@main/core/conversations/claude-transcript', () => ({
  loadClaudeTranscript: vi.fn(async () => [
    { role: 'user', content: 'Build a timer' },
    {
      role: 'assistant',
      content:
        '---YODA_APP_MANIFEST---\n{"name":"Timer","description":"A focused timer"}\n---YODA_APP_HTML---\n<!doctype html><html><body>Timer</body></html>',
    },
  ]),
}));
vi.mock('@main/core/conversations/codex-rollout-terminal-history', () => ({
  loadCodexRolloutTranscriptForConversation: vi.fn(),
}));
vi.mock('@main/core/conversations/getConversationsForTask', () => ({
  getConversationsForTask: vi.fn(async () => [
    {
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      runtimeId: 'claude',
    },
  ]),
}));
vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: vi.fn(() => ({ repoPath: '/project' })) },
}));
vi.mock('@main/lib/events', () => ({ events: { emit: mocks.emit } }));

const directories: string[] = [];

beforeEach(() => {
  mocks.listener = null;
  mocks.emit.mockReset();
});

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('AiLabAppBuildRunner', () => {
  it('persists the completed task output with source navigation metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-runner-'));
    directories.push(directory);
    const jobs = new AiLabBuildJobStore(join(directory, 'jobs.json'));
    const apps = new AiLabAppStore(join(directory, 'apps.json'));
    const runner = new AiLabAppBuildRunner(jobs, apps);

    await runner.prepare({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      prompt: 'Build a timer',
      runtimeId: 'claude',
      model: null,
      createdAt: '2026-07-18T00:00:00.000Z',
    });
    expect(mocks.listener).not.toBeNull();
    mocks.listener?.({
      status: 'completed',
      seen: false,
      pendingAction: null,
      lastForceWorkingAt: 0,
      updatedAt: 1,
    });
    await vi.waitFor(() => expect(mocks.emit).toHaveBeenCalled(), { timeout: 1_000 });

    expect(await apps.list()).toEqual([
      expect.objectContaining({
        name: 'Timer',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
      }),
    ]);
    expect(await jobs.list()).toEqual([]);
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ai-lab:app-created' }),
      expect.objectContaining({ taskId: 'task-1', appName: 'Timer' })
    );
  });
});
