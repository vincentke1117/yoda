import { describe, expect, it } from 'vitest';
import type { ClaudeSessionPrompt, Conversation } from '@shared/conversations';
import {
  buildSessionPromptTree,
  type SessionPromptHistory,
  type SessionPromptTreeNode,
} from './session-prompt-tree-model';

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

function prompt(id: string, overrides: Partial<ClaudeSessionPrompt> = {}): ClaudeSessionPrompt {
  return {
    id,
    text: id,
    timestamp: '2026-07-15T00:00:00.000Z',
    restoreTarget: { kind: 'codex-turn', turnId: `turn-${id}` },
    ...overrides,
  };
}

function history(
  id: string,
  prompts: readonly ClaudeSessionPrompt[],
  overrides: Partial<Conversation> = {}
): SessionPromptHistory {
  return { conversation: conversation(id, overrides), prompts };
}

function flatten(nodes: readonly SessionPromptTreeNode[]): SessionPromptTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

function nodeByKey(nodes: readonly SessionPromptTreeNode[], key: string): SessionPromptTreeNode {
  const node = flatten(nodes).find((candidate) => candidate.key === key);
  if (!node) throw new Error(`Missing logical prompt node: ${key}`);
  return node;
}

describe('buildSessionPromptTree', () => {
  it('merges copied prefixes by fork position without relying on rewritten prompt ids', () => {
    const tree = buildSessionPromptTree(
      [
        history('root', [prompt('root-0'), prompt('root-1'), prompt('same-native-id')]),
        history('branch', [prompt('branch-0'), prompt('branch-1'), prompt('same-native-id')], {
          createdAt: '2026-07-15T00:01:00.000Z',
          forkedFromConversationId: 'root',
          forkedFromPromptIndex: 1,
        }),
      ],
      'branch'
    );

    expect(tree).not.toBeNull();
    const root0 = nodeByKey(tree?.roots ?? [], 'root:0');
    const root1 = nodeByKey(tree?.roots ?? [], 'root:1');

    expect(root0.aliases.map((alias) => [alias.conversation.id, alias.promptIndex])).toEqual([
      ['branch', 0],
      ['root', 0],
    ]);
    expect(root0.preferredAlias.conversation.id).toBe('branch');
    expect(root0.preferredRestoreAlias?.conversation.id).toBe('branch');
    expect(root1.children.map((child) => child.key)).toEqual(['root:2', 'branch:2']);
    expect(root1.children[0]?.preferredAlias.prompt.id).toBe('same-native-id');
    expect(root1.children[1]?.preferredAlias.prompt.id).toBe('same-native-id');
    expect(root1.children[1]?.preferredAlias.promptIndex).toBe(2);
  });

  it('keeps multiple forks at one checkpoint as distinct logical children', () => {
    const tree = buildSessionPromptTree(
      [
        history('root', [prompt('root-0'), prompt('root-1'), prompt('root-2')]),
        history('branch-a', [prompt('a-0'), prompt('a-1'), prompt('a-2')], {
          createdAt: '2026-07-15T00:01:00.000Z',
          forkedFromConversationId: 'root',
          forkedFromPromptIndex: 1,
        }),
        history('branch-b', [prompt('b-0'), prompt('b-1'), prompt('b-2')], {
          createdAt: '2026-07-15T00:02:00.000Z',
          forkedFromConversationId: 'root',
          forkedFromPromptIndex: 1,
        }),
      ],
      'branch-b'
    );

    const forkPoint = nodeByKey(tree?.roots ?? [], 'root:1');
    expect(forkPoint.children.map((child) => child.key)).toEqual([
      'root:2',
      'branch-a:2',
      'branch-b:2',
    ]);
    expect(
      forkPoint.children.filter((child) => child.isOnActivePath).map((child) => child.key)
    ).toEqual(['branch-b:2']);
  });

  it('reattaches a fork-of-fork made inside an inherited prefix to its logical ancestor', () => {
    const tree = buildSessionPromptTree(
      [
        history('root', [prompt('root-0'), prompt('root-1'), prompt('root-2')]),
        history('branch', [prompt('branch-0'), prompt('branch-1'), prompt('branch-2')], {
          forkedFromConversationId: 'root',
          forkedFromPromptIndex: 1,
        }),
        history('grandchild', [prompt('grandchild-0'), prompt('grandchild-1')], {
          forkedFromConversationId: 'branch',
          forkedFromPromptIndex: 0,
        }),
      ],
      'grandchild'
    );

    const logicalRootPrompt = nodeByKey(tree?.roots ?? [], 'root:0');
    expect(logicalRootPrompt.children.map((child) => child.key)).toEqual([
      'root:1',
      'grandchild:1',
    ]);
    expect(logicalRootPrompt.aliases.map((alias) => alias.conversation.id)).toEqual([
      'grandchild',
      'branch',
      'root',
    ]);
    expect(nodeByKey(tree?.roots ?? [], 'grandchild:1').endpoints[0]?.conversation.id).toBe(
      'grandchild'
    );
    expect(nodeByKey(tree?.roots ?? [], 'root:1').isOnActivePath).toBe(false);
  });

  it('attaches an empty fork suffix as a branch endpoint at the inherited checkpoint', () => {
    const tree = buildSessionPromptTree(
      [
        history('root', [prompt('root-0'), prompt('root-1'), prompt('root-2')]),
        history('empty-branch', [prompt('copy-0'), prompt('copy-1')], {
          forkedFromConversationId: 'root',
          forkedFromPromptIndex: 1,
        }),
      ],
      'empty-branch'
    );

    expect(
      nodeByKey(tree?.roots ?? [], 'root:1').endpoints.map((endpoint) => endpoint.conversation.id)
    ).toEqual(['empty-branch']);
    expect(
      nodeByKey(tree?.roots ?? [], 'root:2').endpoints.map((endpoint) => endpoint.conversation.id)
    ).toEqual(['root']);
    expect(nodeByKey(tree?.roots ?? [], 'root:1').isOnActivePath).toBe(true);
    expect(nodeByKey(tree?.roots ?? [], 'root:2').isOnActivePath).toBe(false);
  });

  it('returns only the robust lineage containing the active conversation', () => {
    const orphanTree = buildSessionPromptTree(
      [
        history('other-root', [prompt('other')]),
        history('orphan', [prompt('orphan')], {
          forkedFromConversationId: 'deleted-parent',
        }),
      ],
      'orphan'
    );
    expect(orphanTree?.lineageConversations.map((item) => item.id)).toEqual(['orphan']);
    expect(orphanTree?.roots.map((node) => node.key)).toEqual(['orphan:0']);

    const cycleTree = buildSessionPromptTree(
      [
        history('a', [prompt('a')], {
          forkedFromConversationId: 'b',
          forkedFromPromptIndex: 0,
        }),
        history('b', [prompt('b')], {
          forkedFromConversationId: 'a',
          forkedFromPromptIndex: 0,
        }),
        history('unrelated', [prompt('unrelated')]),
      ],
      'a'
    );
    expect(cycleTree?.lineageConversations.map((item) => item.id)).toEqual(['b', 'a']);
    expect(flatten(cycleTree?.roots ?? []).map((node) => node.key)).toEqual(['b:0']);
    expect(
      nodeByKey(cycleTree?.roots ?? [], 'b:0').aliases.map((alias) => alias.conversation.id)
    ).toEqual(['a', 'b']);
  });

  it('preserves full source indexes and falls back to another restorable alias', () => {
    const tree = buildSessionPromptTree(
      [
        history('root', [prompt('root-0'), prompt('root-1')]),
        history('active', [prompt('active-0'), prompt('active-1', { restoreTarget: undefined })], {
          forkedFromConversationId: 'root',
          forkedFromPromptIndex: 1,
        }),
      ],
      'active'
    );

    const checkpoint = nodeByKey(tree?.roots ?? [], 'root:1');
    expect(checkpoint.preferredAlias).toMatchObject({
      conversation: { id: 'active' },
      prompt: { id: 'active-1' },
      promptIndex: 1,
      isActive: true,
    });
    expect(checkpoint.preferredRestoreAlias).toMatchObject({
      conversation: { id: 'root' },
      prompt: { id: 'root-1' },
      promptIndex: 1,
      isActive: false,
    });
  });

  it('keeps promptless conversations as root-level branch endpoints', () => {
    const tree = buildSessionPromptTree([history('empty', [])], 'empty');

    expect(tree?.roots).toEqual([]);
    expect(tree?.rootEndpoints).toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({ id: 'empty' }),
        isActive: true,
      }),
    ]);
  });

  it('returns null when the active conversation is unavailable', () => {
    expect(buildSessionPromptTree([history('root', [prompt('root')])], 'missing')).toBeNull();
  });
});
