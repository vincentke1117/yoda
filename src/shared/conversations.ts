import type { AgentProviderId } from '@shared/agent-provider-registry';

export type Conversation = {
  id: string;
  projectId: string;
  taskId: string;
  providerId: AgentProviderId;
  title: string;
  lastInteractedAt: string | null;
  resume?: boolean;
  autoApprove?: boolean;
  isInitialConversation: boolean | null;
};

export type RenameConversationParams = {
  conversationId: string;
  newTitle: string;
};

export type ClaudeTodoStatus = 'pending' | 'in_progress' | 'completed';

export type ClaudeTodo = {
  content: string;
  activeForm?: string;
  status: ClaudeTodoStatus;
};

export type ClaudeSessionMetadata = {
  summary: string | null;
  todos: ClaudeTodo[];
  model: string | null;
};

export type CreateConversationParams = {
  id: string;
  projectId: string;
  taskId: string;
  provider: AgentProviderId;
  title: string;
  autoApprove?: boolean;
  isInitialConversation?: boolean;
  initialSize?: { cols: number; rows: number };
  initialPrompt?: string;
};
