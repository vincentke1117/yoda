import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPreArchiveCommand } from './run-pre-archive-command';

const mocks = vi.hoisted(() => ({
  asProvisioned: vi.fn(),
  getConversationSessionInfo: vi.fn(),
  getCodexSessionContext: vi.fn(),
  getTaskStore: vi.fn(),
  sendInput: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: mocks.asProvisioned,
  getTaskStore: mocks.getTaskStore,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    conversations: {
      getConversationSessionInfo: mocks.getConversationSessionInfo,
      getCodexSessionContext: mocks.getCodexSessionContext,
    },
    pty: {
      sendInput: mocks.sendInput,
    },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: {
    warn: mocks.warn,
  },
}));

function makeConversation(providerId: 'codex' | 'claude') {
  const conversation = {
    data: {
      id: 'conversation-1',
      providerId,
      title: providerId === 'codex' ? 'Codex' : 'Claude',
      lastInteractedAt: '2026-05-30T00:00:00.000Z',
    },
    session: {
      sessionId: `${providerId}-session`,
    },
    status: 'idle',
    setStatus: vi.fn((status: string) => {
      conversation.status = status;
    }),
    setWorking: vi.fn(() => {
      conversation.status = 'working';
    }),
    clearWorking: vi.fn(() => {
      if (conversation.status === 'working') {
        conversation.status = 'idle';
      }
    }),
  };
  return conversation;
}

function mockProvisionedConversation(conversation: ReturnType<typeof makeConversation>) {
  mocks.getTaskStore.mockReturnValue({});
  mocks.asProvisioned.mockReturnValue({
    path: '/workspace',
    conversations: {
      conversations: new Map([['conversation-1', conversation]]),
    },
  });
}

describe('runPreArchiveCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConversationSessionInfo.mockResolvedValue({
      sessionId: 'codex-thread-1',
      sessionTitle: 'Resolved Codex thread',
    });
    mocks.getCodexSessionContext.mockResolvedValue({ completedTurnCount: 0 });
    mocks.sendInput.mockResolvedValue({ ok: true });
  });

  it('commits Codex compact commands with space before carriage-return submission', async () => {
    const conversation = makeConversation('codex');
    mockProvisionedConversation(conversation);
    mocks.sendInput.mockImplementation(async (_sessionId: string, data: string) => {
      if (data === '\r') conversation.status = 'completed';
      return { ok: true };
    });

    await runPreArchiveCommand('project-1', 'task-1', 'lovstudio-git-commit-with-context');

    expect(mocks.sendInput.mock.calls).toEqual([
      ['codex-session', '$lovstudio-git-commit-with-context'],
      ['codex-session', ' '],
      ['codex-session', '\r'],
    ]);
  });

  it('keeps carriage-return submission for Claude commands', async () => {
    const conversation = makeConversation('claude');
    mockProvisionedConversation(conversation);
    mocks.sendInput.mockImplementation(async (_sessionId: string, data: string) => {
      if (data === '\r') conversation.status = 'completed';
      return { ok: true };
    });

    await runPreArchiveCommand('project-1', 'task-1', 'lovstudio-git-commit-with-context');

    expect(mocks.sendInput.mock.calls).toEqual([
      ['claude-session', '/lovstudio-git-commit-with-context'],
      ['claude-session', '\r'],
    ]);
  });

  it('sends Ctrl-C and clears working state when interrupted', async () => {
    const conversation = makeConversation('codex');
    const abortController = new AbortController();
    mockProvisionedConversation(conversation);
    mocks.sendInput.mockImplementation(async (_sessionId: string, data: string) => {
      if (data === '\r') abortController.abort();
      return { ok: true };
    });

    await runPreArchiveCommand('project-1', 'task-1', 'lovstudio-git-commit-with-context', {
      signal: abortController.signal,
    });

    expect(mocks.sendInput.mock.calls).toEqual([
      ['codex-session', '$lovstudio-git-commit-with-context'],
      ['codex-session', ' '],
      ['codex-session', '\r'],
      ['codex-session', '\x03'],
    ]);
    expect(conversation.status).toBe('idle');
  });

  it('finishes Codex pre-archive wait when rollout task completion advances', async () => {
    vi.useFakeTimers();
    const conversation = makeConversation('codex');
    mockProvisionedConversation(conversation);
    mocks.getCodexSessionContext
      .mockResolvedValueOnce({ completedTurnCount: 2 })
      .mockResolvedValueOnce({ completedTurnCount: 3 });

    const run = runPreArchiveCommand('project-1', 'task-1', 'lovstudio-git-commit-with-context');
    await vi.runAllTimersAsync();
    await run;

    expect(mocks.getCodexSessionContext).toHaveBeenCalledWith(
      '/workspace',
      'codex-thread-1',
      'Resolved Codex thread'
    );
    expect(conversation.status).toBe('completed');
    vi.useRealTimers();
  });

  it('uses the resolved Codex thread id when polling completion', async () => {
    vi.useFakeTimers();
    const conversation = makeConversation('codex');
    mockProvisionedConversation(conversation);
    mocks.getConversationSessionInfo.mockResolvedValue({
      sessionId: 'actual-codex-thread',
      sessionTitle: 'Actual Codex title',
    });
    mocks.getCodexSessionContext
      .mockResolvedValueOnce({
        threadId: 'actual-codex-thread',
        title: 'Actual Codex title',
        completedTurnCount: 8,
      })
      .mockResolvedValueOnce({
        threadId: 'actual-codex-thread',
        title: 'Actual Codex title',
        completedTurnCount: 9,
      });

    const run = runPreArchiveCommand('project-1', 'task-1', 'lovstudio-git-commit-with-context');
    await vi.runAllTimersAsync();
    await run;

    expect(mocks.getConversationSessionInfo).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      '/workspace'
    );
    expect(mocks.getCodexSessionContext).toHaveBeenNthCalledWith(
      1,
      '/workspace',
      'actual-codex-thread',
      'Actual Codex title'
    );
    expect(mocks.getCodexSessionContext).toHaveBeenNthCalledWith(
      2,
      '/workspace',
      'actual-codex-thread',
      'Actual Codex title'
    );
    vi.useRealTimers();
  });

  it('returns after the Codex-specific timeout when no completion signal arrives', async () => {
    vi.useFakeTimers();
    const conversation = makeConversation('codex');
    mockProvisionedConversation(conversation);
    mocks.getCodexSessionContext.mockResolvedValue({
      threadId: 'codex-thread-1',
      title: 'Resolved Codex thread',
      completedTurnCount: 4,
    });

    const run = runPreArchiveCommand('project-1', 'task-1', 'lovstudio-git-commit-with-context');
    await vi.runAllTimersAsync();
    await run;

    expect(mocks.warn).toHaveBeenCalledWith('runPreArchiveCommand failed', {
      projectId: 'project-1',
      taskId: 'task-1',
      error: 'Error: Timed out waiting for pre-archive command to finish',
    });
    vi.useRealTimers();
  });
});
