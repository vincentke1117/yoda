import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { forkSessionIntoTask } from './forkSessionIntoTask';

const mocks = vi.hoisted(() => ({
  deleteClaudeTranscript: vi.fn(),
  deleteCodexThread: vi.fn(),
  emit: vi.fn(),
  forkClaudeTranscript: vi.fn(),
  forkCodexThread: vi.fn(),
  getClaudeSessionContext: vi.fn(),
  getCodexSessionContext: vi.fn(),
  getRuntimeConfig: vi.fn(),
  mapConversationRowToConversation: vi.fn(),
  resolveTask: vi.fn(),
  startSession: vi.fn(),
  selectChain: {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
  insertChain: {
    values: vi.fn(),
    returning: vi.fn(),
  },
  updateChain: {
    set: vi.fn(),
    where: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => mocks.selectChain),
    insert: vi.fn(() => mocks.insertChain),
    update: vi.fn(() => mocks.updateChain),
  },
}));

vi.mock('../projects/utils', () => ({ resolveTask: mocks.resolveTask }));
vi.mock('../settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: mocks.getRuntimeConfig },
}));
vi.mock('./claude-transcript-fork', () => ({
  deleteClaudeTranscript: mocks.deleteClaudeTranscript,
  forkClaudeTranscript: mocks.forkClaudeTranscript,
}));
vi.mock('./codex-thread-fork', () => ({
  deleteCodexThread: mocks.deleteCodexThread,
  forkCodexThread: mocks.forkCodexThread,
}));
vi.mock('./getClaudeSessionContext', () => ({
  getClaudeSessionContext: mocks.getClaudeSessionContext,
}));
vi.mock('./getCodexSessionContext', () => ({
  getCodexSessionContext: mocks.getCodexSessionContext,
}));
vi.mock('./conversation-events', () => ({
  conversationEvents: { _emit: mocks.emit },
}));
vi.mock('./utils', () => ({
  mapConversationRowToConversation: mocks.mapConversationRowToConversation,
}));

const sourceRow = {
  id: 'source-conversation',
  projectId: 'project-1',
  taskId: 'task-1',
  title: 'Source title',
  runtime: 'codex',
  config: '{"permissionMode":"full-auto"}',
  createdAt: '2026-07-14 10:00:00',
};

const targetTask = {
  projectId: 'project-1',
  taskId: 'task-fork',
  title: 'Source title · #1',
};

function forkParams(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId: 'source-conversation',
    promptIndex: 0,
    target: { kind: 'codex-turn' as const, turnId: 'turn-1' },
    targetTask,
    ...overrides,
  };
}

describe('forkSessionIntoTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectChain.from.mockReturnThis();
    mocks.selectChain.where.mockReturnThis();
    mocks.selectChain.limit.mockResolvedValue([sourceRow]);
    mocks.insertChain.values.mockReturnThis();
    mocks.insertChain.returning.mockResolvedValue([
      {
        ...sourceRow,
        id: 'forked-thread',
        taskId: 'task-fork',
        title: 'Source title · #1',
        titleSource: 'yoda',
        isInitialConversation: true,
        lastInteractedAt: '2026-07-14T11:00:00.000Z',
        forkedFromConversationId: 'source-conversation',
        forkedFromPromptIndex: 0,
      },
    ]);
    mocks.updateChain.set.mockReturnThis();
    mocks.updateChain.where.mockResolvedValue(undefined);
    // The destination task usually sits in its own worktree, so provider
    // context is read from the source cwd and written for the target cwd.
    mocks.resolveTask.mockImplementation((_projectId: string, taskId: string) =>
      taskId === 'task-1'
        ? { conversations: { taskPath: '/repo' } }
        : { conversations: { taskPath: '/repo-fork', startSession: mocks.startSession } }
    );
    mocks.startSession.mockResolvedValue(undefined);
    mocks.getRuntimeConfig.mockImplementation(async (runtimeId: string) =>
      runtimeId === 'claude'
        ? { cli: 'claude', env: { CLAUDE_CONFIG_DIR: '/state/claude' } }
        : { cli: 'codex', env: { CODEX_HOME: '/state/codex' } }
    );
    mocks.deleteClaudeTranscript.mockResolvedValue(undefined);
    mocks.deleteCodexThread.mockResolvedValue(undefined);
    mocks.forkClaudeTranscript.mockResolvedValue('/claude/fork.jsonl');
    mocks.forkCodexThread.mockResolvedValue('forked-thread');
    mocks.getCodexSessionContext.mockResolvedValue({
      threadId: 'source-thread',
      prompts: [
        {
          id: 'prompt-1',
          text: 'Prompt',
          timestamp: null,
          restoreTarget: { kind: 'codex-turn', turnId: 'turn-1' },
        },
      ],
    });
    mocks.getClaudeSessionContext.mockResolvedValue({
      prompts: [
        {
          id: 'prompt-1',
          text: 'Prompt',
          timestamp: null,
          restoreTarget: { kind: 'claude-message', messageId: 'answer-1' },
        },
      ],
    });
    mocks.mapConversationRowToConversation.mockImplementation(
      (row: Record<string, unknown>): Conversation =>
        ({
          ...row,
          runtimeId: row.runtime,
          lastInteractedAt: row.lastInteractedAt ?? null,
        }) as Conversation
    );
  });

  it('forks Codex through the verified turn into the destination task and resumes it', async () => {
    const conversation = await forkSessionIntoTask(
      forkParams({ initialSize: { cols: 120, rows: 32 } })
    );

    expect(mocks.getCodexSessionContext).toHaveBeenCalledWith(
      '/repo',
      'source-conversation',
      'Source title',
      '2026-07-14 10:00:00',
      { codexHome: '/state/codex' }
    );
    expect(mocks.forkCodexThread).toHaveBeenCalledWith({
      threadId: 'source-thread',
      lastTurnId: 'turn-1',
      cwd: '/repo-fork',
      providerConfig: {
        cli: 'codex',
        env: { CODEX_HOME: '/state/codex' },
      },
    });
    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'forked-thread',
        taskId: 'task-fork',
        title: 'Source title · #1',
        titleSource: 'yoda',
        runtime: 'codex',
        config: '{"permissionMode":"full-auto"}',
        isInitialConversation: true,
        forkedFromConversationId: 'source-conversation',
        forkedFromPromptIndex: 0,
      })
    );
    const inserted = mocks.insertChain.values.mock.calls[0]?.[0] as {
      lastInteractedAt: string;
    };
    expect(mocks.updateChain.set).toHaveBeenCalledWith({
      lastInteractedAt: inserted.lastInteractedAt,
    });
    expect(mocks.emit).toHaveBeenCalledWith('conversation:created', conversation);
    expect(mocks.startSession).toHaveBeenCalledWith(conversation, { cols: 120, rows: 32 }, true);
    expect(mocks.startSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.emit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it('rejects a fork that would land as a second session in the source task', async () => {
    await expect(
      forkSessionIntoTask(forkParams({ targetTask: { ...targetTask, taskId: 'task-1' } }))
    ).rejects.toThrow('must land in a different task');

    expect(mocks.forkCodexThread).not.toHaveBeenCalled();
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it('rejects a destination task that is not provisioned', async () => {
    mocks.resolveTask.mockImplementation((_projectId: string, taskId: string) =>
      taskId === 'task-1' ? { conversations: { taskPath: '/repo' } } : undefined
    );

    await expect(forkSessionIntoTask(forkParams())).rejects.toThrow(
      'Task not provisioned: task-fork'
    );
    expect(mocks.forkCodexThread).not.toHaveBeenCalled();
  });

  it('creates a new Claude session id in the destination worktree', async () => {
    mocks.selectChain.limit.mockResolvedValue([{ ...sourceRow, runtime: 'claude' }]);

    await forkSessionIntoTask(
      forkParams({ target: { kind: 'claude-message', messageId: 'answer-1' } })
    );

    const inserted = mocks.insertChain.values.mock.calls[0]?.[0] as {
      id: string;
      forkedFromConversationId: string;
      forkedFromPromptIndex: number;
    };
    expect(mocks.forkClaudeTranscript).toHaveBeenCalledWith({
      cwd: '/repo-fork',
      sourceCwd: '/repo',
      claudeConfigDir: '/state/claude',
      sourceSessionId: 'source-conversation',
      targetSessionId: inserted.id,
      targetMessageId: 'answer-1',
    });
    expect(mocks.getClaudeSessionContext).toHaveBeenCalledWith('/repo', 'source-conversation', {
      claudeConfigDir: '/state/claude',
    });
    expect(inserted.id).not.toBe('source-conversation');
    expect(inserted.forkedFromConversationId).toBe('source-conversation');
    expect(inserted.forkedFromPromptIndex).toBe(0);
  });

  it('removes a pending first prompt from a fork without a stored session source', async () => {
    mocks.selectChain.limit.mockResolvedValue([
      {
        ...sourceRow,
        config: JSON.stringify({
          permissionMode: 'full-auto',
          pendingInitialPrompt: {
            prompt: 'Do not replay me in the fork',
            attemptStartedAtMs: 1_786_387_322_082,
          },
        }),
      },
    ]);

    await forkSessionIntoTask(forkParams());

    const inserted = mocks.insertChain.values.mock.calls[0]?.[0] as { config: string };
    expect(JSON.parse(inserted.config)).toEqual({ permissionMode: 'full-auto' });
  });

  it('removes a pending first prompt and rewrites an existing session source for the fork', async () => {
    const sourceConfig = {
      permissionMode: 'full-auto',
      pendingInitialPrompt: {
        prompt: 'Do not replay me in the fork',
        attemptStartedAtMs: 1_786_387_322_082,
      },
      sessionSource: {
        catalogId: 'old-catalog',
        runtimeId: 'codex',
        sessionId: 'source-thread',
        stateRoot: '/state/codex',
      },
    };
    mocks.selectChain.limit.mockResolvedValue([
      { ...sourceRow, config: JSON.stringify(sourceConfig) },
    ]);
    mocks.mapConversationRowToConversation.mockImplementation(
      (row: Record<string, unknown>): Conversation =>
        ({
          ...row,
          runtimeId: row.runtime,
          lastInteractedAt: row.lastInteractedAt ?? null,
          sessionSource: sourceConfig.sessionSource,
        }) as Conversation
    );

    await forkSessionIntoTask(forkParams());

    const inserted = mocks.insertChain.values.mock.calls[0]?.[0] as { config: string };
    expect(JSON.parse(inserted.config)).toEqual({
      permissionMode: 'full-auto',
      sessionSource: {
        catalogId: expect.any(String),
        runtimeId: 'codex',
        sessionId: 'forked-thread',
        stateRoot: '/state/codex',
      },
    });
    expect(JSON.parse(inserted.config).sessionSource.catalogId).not.toBe('old-catalog');
  });

  it('records the direct parent when a restored branch is forked again', async () => {
    mocks.selectChain.limit.mockResolvedValue([
      {
        ...sourceRow,
        id: 'first-fork',
        title: 'Source title · #1',
        forkedFromConversationId: 'source-conversation',
        forkedFromPromptIndex: 0,
      },
    ]);

    await forkSessionIntoTask(forkParams({ conversationId: 'first-fork' }));

    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        forkedFromConversationId: 'first-fork',
        forkedFromPromptIndex: 0,
      })
    );
  });

  it('rejects stale or tampered targets before creating a provider fork', async () => {
    await expect(
      forkSessionIntoTask(forkParams({ target: { kind: 'codex-turn', turnId: 'other-turn' } }))
    ).rejects.toThrow('restore target is invalid');

    expect(mocks.forkCodexThread).not.toHaveBeenCalled();
    expect(mocks.insertChain.values).not.toHaveBeenCalled();
  });

  it('keeps a durable fork recoverable when its initial session launch fails', async () => {
    mocks.startSession.mockRejectedValueOnce(new Error('launch failed'));

    const conversation = await forkSessionIntoTask(forkParams());

    expect(conversation.resume).toBe(true);
    expect(mocks.emit).toHaveBeenCalledWith('conversation:created', conversation);
    expect(mocks.deleteCodexThread).not.toHaveBeenCalled();
  });

  it('deletes the provider fork when database persistence fails', async () => {
    mocks.insertChain.returning.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(forkSessionIntoTask(forkParams())).rejects.toThrow('database unavailable');

    expect(mocks.deleteCodexThread).toHaveBeenCalledWith('forked-thread', {
      cli: 'codex',
      env: { CODEX_HOME: '/state/codex' },
    });
    expect(mocks.startSession).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('cleans up a Claude fork from its configured state directory', async () => {
    mocks.selectChain.limit.mockResolvedValue([{ ...sourceRow, runtime: 'claude' }]);
    mocks.insertChain.returning.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      forkSessionIntoTask(forkParams({ target: { kind: 'claude-message', messageId: 'answer-1' } }))
    ).rejects.toThrow('database unavailable');

    const targetSessionId = mocks.forkClaudeTranscript.mock.calls[0]?.[0]?.targetSessionId;
    expect(mocks.deleteClaudeTranscript).toHaveBeenCalledWith({
      cwd: '/repo-fork',
      claudeConfigDir: '/state/claude',
      sessionId: targetSessionId,
    });
  });
});
