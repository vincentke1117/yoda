import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { resolveLatestForkCheckpoint } from './resolveLatestForkCheckpoint';

const mocks = vi.hoisted(() => ({
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
  isInitialConversation: true,
};

const params = {
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'source-conversation',
};

describe('resolveLatestForkCheckpoint', () => {
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
  });

  it('picks the latest completed Codex turn and ignores an in-flight prompt', async () => {
    mocks.getCodexSessionContext.mockResolvedValue({
      prompts: [
        { restoreTarget: { kind: 'codex-turn', turnId: 'turn-1' } },
        { restoreTarget: { kind: 'codex-turn', turnId: 'turn-2' } },
        {},
      ],
    });

    await expect(resolveLatestForkCheckpoint(params)).resolves.toEqual({
      promptIndex: 1,
      target: { kind: 'codex-turn', turnId: 'turn-2' },
    });
    expect(mocks.getCodexSessionContext).toHaveBeenCalledWith(
      '/repo',
      source.id,
      source.title,
      source.createdAt,
      { codexHome: '/state/codex' }
    );
  });

  it('picks the latest completed Claude transcript turn', async () => {
    mocks.mapConversationRowToConversation.mockReturnValue({ ...source, runtimeId: 'claude' });
    mocks.getClaudeSessionContext.mockResolvedValue({
      prompts: [{ restoreTarget: { kind: 'claude-message', messageId: 'answer-1' } }],
    });

    await expect(resolveLatestForkCheckpoint(params)).resolves.toEqual({
      promptIndex: 0,
      target: { kind: 'claude-message', messageId: 'answer-1' },
    });
    expect(mocks.getClaudeSessionContext).toHaveBeenCalledWith('/repo', source.id, {
      claudeConfigDir: '/state/claude',
    });
  });

  it('rejects sessions without a completed turn', async () => {
    mocks.getCodexSessionContext.mockResolvedValue({ prompts: [{}] });

    await expect(resolveLatestForkCheckpoint(params)).rejects.toThrow('no completed turn');
  });

  it('rejects runtimes without native fork support', async () => {
    mocks.mapConversationRowToConversation.mockReturnValue({ ...source, runtimeId: 'gemini' });

    await expect(resolveLatestForkCheckpoint(params)).rejects.toThrow(
      'Runtime does not support conversation fork: gemini'
    );
  });
});
