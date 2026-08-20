import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionTitleManager } from './session-title-manager';
import type { TitleListener } from './types';

const mocks = vi.hoisted(() => ({
  emitConversationEvent: vi.fn(),
  emitRendererEvent: vi.fn(),
  selectLimit: vi.fn(),
  syncTaskNameFromSession: vi.fn(),
  updateReturning: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from() {
        return this;
      },
      where() {
        return this;
      },
      limit: mocks.selectLimit,
    })),
    update: vi.fn(() => ({
      set() {
        return this;
      },
      where() {
        return this;
      },
      returning: mocks.updateReturning,
    })),
  },
}));

vi.mock('@main/core/conversations/conversation-events', () => ({
  conversationEvents: { _emit: mocks.emitConversationEvent },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: mocks.emitRendererEvent },
}));

vi.mock('@main/core/tasks/operations/task-name-sync', () => ({
  syncTaskNameFromSession: mocks.syncTaskNameFromSession,
}));

describe('SessionTitleManager', () => {
  let onTitle: TitleListener | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    onTitle = undefined;
    sessionTitleManager.register({
      runtimeId: 'codex',
      watch: (_ctx, listener) => {
        onTitle = listener;
        return { stop: vi.fn() };
      },
    });
    sessionTitleManager.start({
      runtimeId: 'codex',
      conversationId: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      cwd: '/workspace',
    });
    mocks.selectLimit.mockResolvedValue([{ title: 'Old title', titleSource: 'agent' }]);
  });

  it('does not emit a stale rename when the guarded update loses ownership', async () => {
    mocks.updateReturning.mockResolvedValue([]);

    onTitle?.('New title');
    await vi.waitFor(() => expect(mocks.updateReturning).toHaveBeenCalledOnce());

    expect(mocks.emitConversationEvent).not.toHaveBeenCalled();
    expect(mocks.emitRendererEvent).not.toHaveBeenCalled();
    expect(mocks.syncTaskNameFromSession).not.toHaveBeenCalled();
  });

  it('emits the rename only after the guarded update succeeds', async () => {
    mocks.updateReturning.mockResolvedValue([{ id: 'conversation-1' }]);

    onTitle?.('New title');
    await vi.waitFor(() => expect(mocks.emitConversationEvent).toHaveBeenCalledOnce());

    expect(mocks.emitRendererEvent).toHaveBeenCalledOnce();
    // A task is its session, so the reported title names the task as well.
    expect(mocks.syncTaskNameFromSession).toHaveBeenCalledWith('project-1', 'task-1', 'New title');
  });
});
