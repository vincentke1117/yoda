import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt, Conversation } from '@shared/conversations';
import type { ForkTaskResult } from '@shared/tasks';
import { forkTaskIntoNewTask, isTaskForkPending } from '@renderer/features/tasks/fork-task';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { useRequireProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useNavigate, type NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';

export type ConversationPromptLocation = {
  conversation: Conversation;
  prompt: ClaudeSessionPrompt;
  /** Zero-based index in the source conversation's complete transcript. */
  promptIndex: number;
};

export type RestoringConversationPrompt = {
  conversationId: string;
  promptId: string;
  promptIndex: number;
};

/**
 * Shared execution path for every surface that forks a prompt checkpoint.
 * Callers own confirmation and success/error messaging; the fork itself lands as
 * a new same-branch task and routes there.
 */
export async function forkTaskAtPrompt(
  provisionedTask: ProvisionedTask,
  { conversation, prompt, promptIndex }: ConversationPromptLocation,
  navigate: NavigateFnTyped
): Promise<ForkTaskResult | null> {
  if (!prompt.restoreTarget) return null;
  const initialSize =
    provisionedTask.conversations.conversations.get(conversation.id)?.session.pty?.lastSentDims ??
    undefined;
  return forkTaskIntoNewTask(
    {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
      mode: 'same-branch',
      checkpoint: { promptIndex, target: prompt.restoreTarget },
      initialSize,
    },
    navigate
  );
}

/**
 * Shared context-checkpoint action for every prompt-history surface. The source
 * conversation is explicit because a tree can contain checkpoints from several
 * sibling (and archived) conversations at once.
 */
export function useConversationPromptRestore(): {
  restoringPrompt: RestoringConversationPrompt | null;
  requestRestorePrompt: (location: ConversationPromptLocation) => void;
} {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const provisionedTask = useRequireProvisionedTask();
  const showRestoreConfirm = useShowModal('confirmActionModal');
  const pendingRef = useRef(false);
  const [restoringPrompt, setRestoringPrompt] = useState<RestoringConversationPrompt | null>(null);

  const restorePrompt = useCallback(
    async (location: ConversationPromptLocation) => {
      const { conversation, prompt, promptIndex } = location;
      if (!prompt.restoreTarget || pendingRef.current) return;
      if (
        isTaskForkPending({
          projectId: conversation.projectId,
          taskId: conversation.taskId,
          conversationId: conversation.id,
          checkpoint: { promptIndex, target: prompt.restoreTarget },
        })
      ) {
        return;
      }

      pendingRef.current = true;
      setRestoringPrompt({
        conversationId: conversation.id,
        promptId: prompt.id,
        promptIndex,
      });
      try {
        await forkTaskAtPrompt(provisionedTask, location, navigate);
        toast({ title: t('tasks.sessionInfo.restoreContextSuccess') });
      } catch (error) {
        toast({
          title: t('tasks.sessionInfo.restoreContextFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
          debugInfo: error,
        });
      } finally {
        pendingRef.current = false;
        setRestoringPrompt(null);
      }
    },
    [navigate, provisionedTask, t]
  );

  const requestRestorePrompt = useCallback(
    (location: ConversationPromptLocation) => {
      const { conversation, prompt, promptIndex } = location;
      if (!prompt.restoreTarget || pendingRef.current) return;
      if (
        isTaskForkPending({
          projectId: conversation.projectId,
          taskId: conversation.taskId,
          conversationId: conversation.id,
          checkpoint: { promptIndex, target: prompt.restoreTarget },
        })
      ) {
        return;
      }

      showRestoreConfirm({
        title: t('tasks.sessionInfo.restoreContextTitle', { index: promptIndex + 1 }),
        description: t('tasks.sessionInfo.restoreContextDescription'),
        confirmLabel: t('tasks.sessionInfo.restoreContextConfirm'),
        variant: 'default',
        onSuccess: () => void restorePrompt(location),
      });
    },
    [restorePrompt, showRestoreConfirm, t]
  );

  return { restoringPrompt, requestRestorePrompt };
}
