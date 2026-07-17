import { supportsRuntimeConversationFork } from '@shared/runtime-registry';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { toast } from '@renderer/lib/hooks/use-toast';

export function canForkConversation(provisioned: ProvisionedTask, conversationId: string): boolean {
  const conversation = provisioned.conversations.conversations.get(conversationId)?.data;
  return conversation ? supportsRuntimeConversationFork(conversation.runtimeId) : false;
}

export async function forkConversationIntoNewTab({
  provisioned,
  projectId,
  taskId,
  conversationId,
  messages,
}: {
  provisioned: ProvisionedTask;
  projectId: string;
  taskId: string;
  conversationId: string;
  messages: { success: string; failure: string };
}): Promise<void> {
  try {
    const initialSize =
      provisioned.conversations.conversations.get(conversationId)?.session.pty?.lastSentDims ??
      undefined;
    const fork = await provisioned.conversations.forkConversation({
      projectId,
      taskId,
      conversationId,
      initialSize,
    });
    provisioned.taskView.tabManager.openConversation(fork.id);
    provisioned.taskView.setFocusedRegion('main');
    toast({ title: messages.success });
  } catch (error) {
    toast({
      title: messages.failure,
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
      debugInfo: error,
    });
  }
}
