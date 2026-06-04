import { observable } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import type { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { TabManagerStore } from './tab-manager-store';

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => () => {}),
  },
  rpc: {},
}));

describe('TabManagerStore conversation recovery', () => {
  it('reopens the most recently closed conversation', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
        makeConversation('conversation-2', '2026-05-02T00:00:00.000Z', false),
      ]),
      'workspace-1'
    );

    store.openConversation('conversation-1');
    const tabId = store.resolvedActiveTabId;
    if (!tabId) throw new Error('Expected an active tab');

    store.closeTab(tabId);
    expect(store.resolvedTabs).toHaveLength(0);

    expect(store.openLastConversation()).toBe(true);
    expect(store.activeConversationId).toBe('conversation-1');
  });

  it('falls back to the most recently interacted conversation', () => {
    const store = new TabManagerStore(
      makeConversationManager([
        makeConversation('conversation-1', '2026-05-01T00:00:00.000Z', true),
        makeConversation('conversation-2', '2026-05-02T00:00:00.000Z', false),
      ]),
      'workspace-1'
    );

    expect(store.openLastConversation()).toBe(true);
    expect(store.activeConversationId).toBe('conversation-2');
  });
});

function makeConversation(id: string, lastInteractedAt: string, isInitialConversation: boolean) {
  const data: Conversation = {
    id,
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'claude',
    title: id,
    lastInteractedAt,
    isInitialConversation,
  };
  return {
    data,
    isInitialConversation,
    seen: true,
    markSeen: () => {},
  };
}

function makeConversationManager(
  conversations: ReturnType<typeof makeConversation>[]
): ConversationManagerStore {
  return {
    conversations: observable.map(
      conversations.map((conversation) => [conversation.data.id, conversation])
    ),
  } as unknown as ConversationManagerStore;
}
