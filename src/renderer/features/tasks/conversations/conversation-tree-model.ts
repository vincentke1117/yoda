import type { Conversation } from '@shared/conversations';

export type ConversationTreeNode = {
  conversation: Conversation;
  children: ConversationTreeNode[];
  isOnActivePath: boolean;
};

type MutableConversationTreeNode = ConversationTreeNode & {
  subtreeActivityAt: number;
};

/**
 * Builds a provider-neutral conversation forest from persisted direct-parent
 * metadata. Missing parents and malformed cycles remain visible as roots.
 */
export function buildConversationTree(
  conversations: readonly Conversation[],
  activeConversationId?: string | null
): ConversationTreeNode[] {
  const conversationsById = new Map<string, Conversation>();
  for (const conversation of conversations) {
    // Active rows are passed before archived rows, so a transient duplicate
    // during archive/unarchive keeps the live store-backed version.
    if (!conversationsById.has(conversation.id)) {
      conversationsById.set(conversation.id, conversation);
    }
  }

  const parentById = new Map<string, string>();
  for (const id of [...conversationsById.keys()].sort(compareText)) {
    const parentId = conversationsById.get(id)?.forkedFromConversationId;
    if (
      !parentId ||
      parentId === id ||
      !conversationsById.has(parentId) ||
      wouldCreateCycle(id, parentId, parentById)
    ) {
      continue;
    }
    parentById.set(id, parentId);
  }

  const activePathIds = new Set<string>();
  let pathCursor = activeConversationId ?? undefined;
  while (pathCursor && conversationsById.has(pathCursor) && !activePathIds.has(pathCursor)) {
    activePathIds.add(pathCursor);
    pathCursor = parentById.get(pathCursor);
  }

  const nodesById = new Map<string, MutableConversationTreeNode>();
  for (const conversation of conversationsById.values()) {
    nodesById.set(conversation.id, {
      conversation,
      children: [],
      isOnActivePath: activePathIds.has(conversation.id),
      subtreeActivityAt: conversationActivityAt(conversation),
    });
  }

  const roots: MutableConversationTreeNode[] = [];
  for (const [id, node] of nodesById) {
    const parent = nodesById.get(parentById.get(id) ?? '');
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  for (const root of roots) {
    finalizeSubtree(root);
  }
  roots.sort(compareRoots);
  return roots;
}

function wouldCreateCycle(
  childId: string,
  candidateParentId: string,
  parentById: ReadonlyMap<string, string>
): boolean {
  let cursor: string | undefined = candidateParentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === childId || visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = parentById.get(cursor);
  }
  return false;
}

function finalizeSubtree(node: MutableConversationTreeNode): number {
  node.children.sort(compareSiblings);
  for (const child of node.children as MutableConversationTreeNode[]) {
    node.subtreeActivityAt = Math.max(node.subtreeActivityAt, finalizeSubtree(child));
  }
  return node.subtreeActivityAt;
}

function compareSiblings(a: ConversationTreeNode, b: ConversationTreeNode): number {
  const promptDelta =
    (a.conversation.forkedFromPromptIndex ?? Number.POSITIVE_INFINITY) -
    (b.conversation.forkedFromPromptIndex ?? Number.POSITIVE_INFINITY);
  if (promptDelta !== 0) return promptDelta;

  const createdDelta = timestamp(a.conversation.createdAt) - timestamp(b.conversation.createdAt);
  if (createdDelta !== 0) return createdDelta;
  return compareText(a.conversation.id, b.conversation.id);
}

function compareRoots(a: MutableConversationTreeNode, b: MutableConversationTreeNode): number {
  const activityDelta = b.subtreeActivityAt - a.subtreeActivityAt;
  if (activityDelta !== 0) return activityDelta;
  return compareText(a.conversation.id, b.conversation.id);
}

function conversationActivityAt(conversation: Conversation): number {
  return Math.max(
    timestamp(conversation.lastInteractedAt),
    timestamp(conversation.archivedAt),
    timestamp(conversation.createdAt)
  );
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
