import type { ClaudeSessionPrompt, Conversation } from '@shared/conversations';
import { buildConversationTree, type ConversationTreeNode } from './conversation-tree-model';

export type SessionPromptHistory = {
  conversation: Conversation;
  prompts: readonly ClaudeSessionPrompt[];
};

/** A concrete provider transcript that can display or restore one logical prompt. */
export type SessionPromptAlias = {
  conversation: Conversation;
  prompt: ClaudeSessionPrompt;
  /** Full zero-based prompt index in this alias's source transcript. */
  promptIndex: number;
  isActive: boolean;
};

/** Marks the logical end of a persisted conversation, including an empty fork suffix. */
export type SessionPromptBranchEndpoint = {
  conversation: Conversation;
  isActive: boolean;
};

export type SessionPromptTreeNode = {
  /** Stable logical identity; deliberately independent of provider prompt ids. */
  key: string;
  /** All known source transcripts for this logical prompt, active source first. */
  aliases: SessionPromptAlias[];
  preferredAlias: SessionPromptAlias;
  /** Active restorable source first, then any other restorable source. */
  preferredRestoreAlias: SessionPromptAlias | null;
  children: SessionPromptTreeNode[];
  endpoints: SessionPromptBranchEndpoint[];
  isOnActivePath: boolean;
};

export type SessionPromptTree = {
  /** Direct-parent preorder for the one lineage containing the active conversation. */
  lineageConversations: Conversation[];
  roots: SessionPromptTreeNode[];
  /** Conversations whose known logical path contains no prompt. */
  rootEndpoints: SessionPromptBranchEndpoint[];
};

type MutableSessionPromptTreeNode = {
  key: string;
  aliases: SessionPromptAlias[];
  children: MutableSessionPromptTreeNode[];
  endpoints: SessionPromptBranchEndpoint[];
};

/**
 * Builds the logical prompt tree for the lineage containing the active conversation.
 *
 * A restored provider transcript rewrites native prompt ids, so shared ancestry is
 * merged exclusively by persisted direct-parent metadata and prompt positions.
 */
export function buildSessionPromptTree(
  histories: readonly SessionPromptHistory[],
  activeConversationId: string
): SessionPromptTree | null {
  const historiesByConversationId = new Map<string, SessionPromptHistory>();
  for (const history of histories) {
    // Active/store-backed histories are expected first. Keep the first copy
    // during a transient archive/unarchive duplicate, matching conversation tree behavior.
    if (!historiesByConversationId.has(history.conversation.id)) {
      historiesByConversationId.set(history.conversation.id, history);
    }
  }

  if (!historiesByConversationId.has(activeConversationId)) return null;

  const conversationRoots = buildConversationTree(
    [...historiesByConversationId.values()].map((history) => history.conversation),
    activeConversationId
  );
  const lineageRoot = conversationRoots.find((root) => root.isOnActivePath);
  if (!lineageRoot) return null;

  const roots: MutableSessionPromptTreeNode[] = [];
  const rootEndpoints: SessionPromptBranchEndpoint[] = [];
  const logicalPathsByConversationId = new Map<string, MutableSessionPromptTreeNode[]>();
  const lineageConversations: Conversation[] = [];

  buildLineage({
    conversationNode: lineageRoot,
    parentPath: null,
    historiesByConversationId,
    activeConversationId,
    roots,
    rootEndpoints,
    logicalPathsByConversationId,
    lineageConversations,
  });

  const activePath = new Set(
    (logicalPathsByConversationId.get(activeConversationId) ?? []).map((node) => node.key)
  );

  return {
    lineageConversations,
    roots: roots.map((root) => finalizeNode(root, activePath)),
    rootEndpoints: sortEndpoints(rootEndpoints, activeConversationId),
  };
}

type BuildLineageParams = {
  conversationNode: ConversationTreeNode;
  parentPath: MutableSessionPromptTreeNode[] | null;
  historiesByConversationId: ReadonlyMap<string, SessionPromptHistory>;
  activeConversationId: string;
  roots: MutableSessionPromptTreeNode[];
  rootEndpoints: SessionPromptBranchEndpoint[];
  logicalPathsByConversationId: Map<string, MutableSessionPromptTreeNode[]>;
  lineageConversations: Conversation[];
};

function buildLineage({
  conversationNode,
  parentPath,
  historiesByConversationId,
  activeConversationId,
  roots,
  rootEndpoints,
  logicalPathsByConversationId,
  lineageConversations,
}: BuildLineageParams): void {
  const conversation = conversationNode.conversation;
  const prompts = historiesByConversationId.get(conversation.id)?.prompts ?? [];
  const path: MutableSessionPromptTreeNode[] = [];
  const forkIndex = parentPath ? validForkIndex(conversation.forkedFromPromptIndex) : -1;

  if (parentPath) {
    const inheritedCount = forkIndex + 1;

    // A child's copied transcript can reconstruct a temporarily unavailable
    // parent prefix. Sibling forks then share the same logical nodes by index.
    while (parentPath.length < inheritedCount && parentPath.length < prompts.length) {
      const promptIndex = parentPath.length;
      const node = createNode(
        conversation.forkedFromConversationId ?? conversation.id,
        promptIndex
      );
      appendNode(parentPath.at(-1), node, roots);
      parentPath.push(node);
    }

    path.push(...parentPath.slice(0, inheritedCount));
    for (
      let promptIndex = 0;
      promptIndex < Math.min(prompts.length, path.length);
      promptIndex += 1
    ) {
      addAlias(
        path[promptIndex],
        conversation,
        prompts[promptIndex],
        promptIndex,
        activeConversationId
      );
    }
  }

  const suffixStart = parentPath ? forkIndex + 1 : 0;
  let previous = path.at(-1);
  for (let promptIndex = suffixStart; promptIndex < prompts.length; promptIndex += 1) {
    const node = createNode(conversation.id, promptIndex);
    addAlias(node, conversation, prompts[promptIndex], promptIndex, activeConversationId);
    appendNode(previous, node, roots);
    path.push(node);
    previous = node;
  }

  const endpoint = {
    conversation,
    isActive: conversation.id === activeConversationId,
  };
  const leaf = path.at(-1);
  if (leaf) {
    leaf.endpoints.push(endpoint);
  } else {
    rootEndpoints.push(endpoint);
  }

  logicalPathsByConversationId.set(conversation.id, path);
  lineageConversations.push(conversation);

  for (const child of conversationNode.children) {
    buildLineage({
      conversationNode: child,
      parentPath: path,
      historiesByConversationId,
      activeConversationId,
      roots,
      rootEndpoints,
      logicalPathsByConversationId,
      lineageConversations,
    });
  }
}

function createNode(
  ownerConversationId: string,
  promptIndex: number
): MutableSessionPromptTreeNode {
  return {
    key: logicalPromptKey(ownerConversationId, promptIndex),
    aliases: [],
    children: [],
    endpoints: [],
  };
}

function logicalPromptKey(conversationId: string, promptIndex: number): string {
  return `${conversationId}:${promptIndex}`;
}

function appendNode(
  parent: MutableSessionPromptTreeNode | undefined,
  node: MutableSessionPromptTreeNode,
  roots: MutableSessionPromptTreeNode[]
): void {
  if (parent) {
    parent.children.push(node);
  } else {
    roots.push(node);
  }
}

function addAlias(
  node: MutableSessionPromptTreeNode,
  conversation: Conversation,
  prompt: ClaudeSessionPrompt | undefined,
  promptIndex: number,
  activeConversationId: string
): void {
  if (!prompt) return;
  node.aliases.push({
    conversation,
    prompt,
    promptIndex,
    isActive: conversation.id === activeConversationId,
  });
}

function finalizeNode(
  node: MutableSessionPromptTreeNode,
  activePath: ReadonlySet<string>
): SessionPromptTreeNode {
  const aliases = sortAliases(node.aliases);
  const preferredAlias = aliases[0];
  if (!preferredAlias) {
    throw new Error(`Logical prompt node has no source alias: ${node.key}`);
  }

  return {
    key: node.key,
    aliases,
    preferredAlias,
    preferredRestoreAlias: aliases.find((alias) => Boolean(alias.prompt.restoreTarget)) ?? null,
    children: node.children.map((child) => finalizeNode(child, activePath)),
    endpoints: sortEndpoints(node.endpoints, null),
    isOnActivePath: activePath.has(node.key),
  };
}

function sortAliases(aliases: readonly SessionPromptAlias[]): SessionPromptAlias[] {
  return [...aliases].sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
    const createdDelta =
      timestamp(left.conversation.createdAt) - timestamp(right.conversation.createdAt);
    if (createdDelta !== 0) return createdDelta;
    const idDelta = compareText(left.conversation.id, right.conversation.id);
    if (idDelta !== 0) return idDelta;
    return left.promptIndex - right.promptIndex;
  });
}

function sortEndpoints(
  endpoints: readonly SessionPromptBranchEndpoint[],
  activeConversationId: string | null
): SessionPromptBranchEndpoint[] {
  return [...endpoints].sort((left, right) => {
    const leftIsActive = left.isActive || left.conversation.id === activeConversationId;
    const rightIsActive = right.isActive || right.conversation.id === activeConversationId;
    if (leftIsActive !== rightIsActive) return leftIsActive ? -1 : 1;
    const createdDelta =
      timestamp(left.conversation.createdAt) - timestamp(right.conversation.createdAt);
    if (createdDelta !== 0) return createdDelta;
    return compareText(left.conversation.id, right.conversation.id);
  });
}

function validForkIndex(value: number | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : -1;
}

function timestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
