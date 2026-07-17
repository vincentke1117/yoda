import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { forkConversation } from './forkConversation';

const mocks = vi.hoisted(() => ({
  forkConversationAtPrompt: vi.fn(),
  getClaudeSessionContext: vi.fn(),
  getCodexSessionContext: vi.fn(),
  getRuntimeConfig: vi.fn(),
  mapConversationRowToConversation: vi.fn(),
  resolveRuntimeStateDirectory: vi.fn(),
  resolveTask: vi.fn(),
  selectChain: {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: { select: vi.fn(() => mocks.selectChain) },
}));
vi.mock('../projects/utils', () => ({ resolveTask: mocks.resolveTask }));
vi.mock('../settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: mocks.getRuntimeConfig },
}));
vi.mock('./forkConversationAtPrompt', () => ({
  forkConversationAtPrompt: mocks.forkConversationAtPrompt,
}));
vi.mock('./getClaudeSessionContext', () => ({
  getClaudeSessionContext: mocks.getClaudeSessionContext,
}));
vi.mock('./getCodexSessionContext', () => ({
  getCodexSessionContext: mocks.getCodexSessionContext,
}));
vi.mock('./impl/runtime-env', () => ({
  resolveRuntimeStateDirectory: mocks.resolveRuntimeStateDirectory,
}));
vi.mock('./utils', () => ({
  mapConversationRowToConversation: mocks.mapConversationRowToConversation,
}));

const source: Conversation = {
  id: 'source-conversation',
  projectId: 'project-1',
  taskId: 'task-1',
  runtimeId: 'codex',
  title: 'Source title',
  createdAt: '2026-07-17T10:00:00.000Z',
  lastInteractedAt: '2026-07-17T10:00:00.000Z',
  isInitialConversation: false,
};

const params = {
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'source-conversation',
  initialSize: { cols: 132, rows: 40 },
};

describe('forkConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectChain.from.mockReturnThis();
    mocks.selectChain.where.mockReturnThis();
    mocks.selectChain.limit.mockResolvedValue([{ id: source.id }]);
    mocks.mapConversationRowToConversation.mockReturnValue(source);
    mocks.resolveTask.mockReturnValue({ conversations: { taskPath: '/repo' } });
    mocks.resolveRuntimeStateDirectory.mockImplementation((runtimeId: string) =>
      runtimeId === 'codex' ? '/state/codex' : '/state/claude'
    );
    mocks.forkConversationAtPrompt.mockResolvedValue({ ...source, id: 'forked-conversation' });
  });

  it('forks Codex from the latest completed turn and ignores an in-flight prompt', async () => {
    mocks.getCodexSessionContext.mockResolvedValue({
      prompts: [
        { restoreTarget: { kind: 'codex-turn', turnId: 'turn-1' } },
        { restoreTarget: { kind: 'codex-turn', turnId: 'turn-2' } },
        {},
      ],
    });

    await forkConversation(params);

    expect(mocks.getCodexSessionContext).toHaveBeenCalledWith(
      '/repo',
      source.id,
      source.title,
      source.createdAt,
      { codexHome: '/state/codex' }
    );
    expect(mocks.forkConversationAtPrompt).toHaveBeenCalledWith({
      ...params,
      promptIndex: 1,
      target: { kind: 'codex-turn', turnId: 'turn-2' },
    });
  });

  it('forks Claude from its latest completed transcript turn', async () => {
    mocks.mapConversationRowToConversation.mockReturnValue({ ...source, runtimeId: 'claude' });
    mocks.getClaudeSessionContext.mockResolvedValue({
      prompts: [{ restoreTarget: { kind: 'claude-message', messageId: 'answer-1' } }],
    });

    await forkConversation(params);

    expect(mocks.getClaudeSessionContext).toHaveBeenCalledWith('/repo', source.id, {
      claudeConfigDir: '/state/claude',
    });
    expect(mocks.forkConversationAtPrompt).toHaveBeenCalledWith({
      ...params,
      promptIndex: 0,
      target: { kind: 'claude-message', messageId: 'answer-1' },
    });
  });

  it('rejects sessions without a completed turn', async () => {
    mocks.getCodexSessionContext.mockResolvedValue({ prompts: [{}] });

    await expect(forkConversation(params)).rejects.toThrow('no completed turn');
    expect(mocks.forkConversationAtPrompt).not.toHaveBeenCalled();
  });

  it('rejects runtimes without native fork support', async () => {
    mocks.mapConversationRowToConversation.mockReturnValue({ ...source, runtimeId: 'gemini' });

    await expect(forkConversation(params)).rejects.toThrow(
      'Runtime does not support conversation fork: gemini'
    );
  });
});
