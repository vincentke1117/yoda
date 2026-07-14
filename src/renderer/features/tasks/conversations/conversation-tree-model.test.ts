import { describe, expect, it } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { buildConversationTree, type ConversationTreeNode } from './conversation-tree-model';

function conversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    projectId: 'project-1',
    taskId: 'task-1',
    runtimeId: 'codex',
    title: id,
    createdAt: '2026-07-15T00:00:00.000Z',
    lastInteractedAt: '2026-07-15T00:00:00.000Z',
    isInitialConversation: false,
    ...overrides,
  };
}

function flatten(nodes: readonly ConversationTreeNode[]): ConversationTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe('buildConversationTree', () => {
  it('builds fork-of-fork ancestry and orders siblings by prompt then creation time', () => {
    const roots = buildConversationTree([
      conversation('root'),
      conversation('late-prompt', {
        createdAt: '2026-07-15T00:01:00.000Z',
        forkedFromConversationId: 'root',
        forkedFromPromptIndex: 3,
      }),
      conversation('same-prompt-later', {
        createdAt: '2026-07-15T00:03:00.000Z',
        forkedFromConversationId: 'root',
        forkedFromPromptIndex: 1,
      }),
      conversation('same-prompt-earlier', {
        createdAt: '2026-07-15T00:02:00.000Z',
        forkedFromConversationId: 'root',
        forkedFromPromptIndex: 1,
      }),
      conversation('grandchild', {
        forkedFromConversationId: 'same-prompt-earlier',
        forkedFromPromptIndex: 0,
      }),
    ]);

    expect(roots).toHaveLength(1);
    expect(roots[0]?.children.map((node) => node.conversation.id)).toEqual([
      'same-prompt-earlier',
      'same-prompt-later',
      'late-prompt',
    ]);
    expect(roots[0]?.children[0]?.children[0]?.conversation.id).toBe('grandchild');
  });

  it('keeps an archived parent connected to its active branch and marks the active path', () => {
    const roots = buildConversationTree(
      [
        conversation('archived-parent', { archivedAt: '2026-07-15T00:10:00.000Z' }),
        conversation('active-child', {
          forkedFromConversationId: 'archived-parent',
          forkedFromPromptIndex: 2,
        }),
        conversation('other-root'),
      ],
      'active-child'
    );
    const nodes = flatten(roots);

    expect(
      nodes.find((node) => node.conversation.id === 'archived-parent')?.children[0]?.conversation.id
    ).toBe('active-child');
    expect(
      nodes
        .filter((node) => node.isOnActivePath)
        .map((node) => node.conversation.id)
        .sort()
    ).toEqual(['active-child', 'archived-parent']);
    expect(nodes.find((node) => node.conversation.id === 'other-root')?.isOnActivePath).toBe(false);
  });

  it('sorts root groups by the newest activity anywhere in each branch', () => {
    const roots = buildConversationTree([
      conversation('older-root', { lastInteractedAt: '2026-07-15T00:01:00.000Z' }),
      conversation('newer-root', { lastInteractedAt: '2026-07-15T00:02:00.000Z' }),
      conversation('active-descendant', {
        forkedFromConversationId: 'older-root',
        forkedFromPromptIndex: 0,
        lastInteractedAt: '2026-07-15T00:03:00.000Z',
      }),
    ]);

    expect(roots.map((node) => node.conversation.id)).toEqual(['older-root', 'newer-root']);
  });

  it('promotes missing parents and malformed cycles instead of dropping rows', () => {
    const roots = buildConversationTree([
      conversation('orphan', { forkedFromConversationId: 'deleted-parent' }),
      conversation('a', { forkedFromConversationId: 'b' }),
      conversation('b', { forkedFromConversationId: 'a' }),
      conversation('self', { forkedFromConversationId: 'self' }),
    ]);

    expect(
      flatten(roots)
        .map((node) => node.conversation.id)
        .sort()
    ).toEqual(['a', 'b', 'orphan', 'self']);
  });

  it('deduplicates transient active and archived copies by id', () => {
    const roots = buildConversationTree([
      conversation('same', { title: 'active' }),
      conversation('same', { title: 'archived', archivedAt: '2026-07-15T00:10:00.000Z' }),
    ]);

    expect(flatten(roots)).toHaveLength(1);
    expect(roots[0]?.conversation.title).toBe('active');
  });
});
