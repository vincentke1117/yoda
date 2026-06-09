import { useCallback } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { runPreArchiveCommand } from '@renderer/features/tasks/run-pre-archive-command';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';

type ArchiveTaskOptions = {
  note?: string;
  skipPreCommand?: boolean;
};

type ArchiveTaskWithPreCommandOptions = ArchiveTaskOptions & {
  preArchiveCommand: string;
};

type ArchiveConversationOptions = {
  preArchiveCommand: string;
  skipPreCommand?: boolean;
};

export function useArchiveTask(projectId: string): {
  archiveTask: (taskId: string, options?: ArchiveTaskOptions) => Promise<void>;
  hasPreArchiveCommand: boolean;
} {
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const preArchiveCommand = homeDraft?.preArchiveCommand ?? '';
  const hasPreArchiveCommand = preArchiveCommand.trim().length > 0;

  const archiveTask = useCallback(
    (taskId: string, options: ArchiveTaskOptions = {}) =>
      archiveTaskWithPreCommand(projectId, taskId, {
        ...options,
        preArchiveCommand,
      }),
    [preArchiveCommand, projectId]
  );

  return { archiveTask, hasPreArchiveCommand };
}

/**
 * Run the pre-archive command against the conversation (unless skipped) and
 * archive it. The conversation store is flagged `isArchiving` for the whole
 * flow so its tab renders a loading state.
 */
export async function archiveConversationWithPreCommand(
  projectId: string,
  taskId: string,
  conversationId: string,
  options: ArchiveConversationOptions
): Promise<void> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return;

  const target = provisioned.conversations.conversations.get(conversationId);
  target?.setArchiving(true);
  try {
    if (!options.skipPreCommand && options.preArchiveCommand.trim().length > 0) {
      await runPreArchiveCommand(projectId, taskId, conversationId, options.preArchiveCommand);
    }
    await provisioned.conversations.archiveConversation(conversationId);
  } finally {
    target?.setArchiving(false);
  }
}

/**
 * Archive the task when its last conversation is gone — archiving the final
 * conversation implies the task itself is finished. No-op while any
 * conversation is still active.
 */
export async function archiveTaskIfNoConversationsLeft(
  projectId: string,
  taskId: string
): Promise<void> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned || provisioned.conversations.conversations.size > 0) return;

  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) return;

  taskManager.setTaskArchiving(taskId, true);
  try {
    await taskManager.archiveTask(taskId);
  } finally {
    taskManager.setTaskArchiving(taskId, false);
  }
}

/**
 * Archive every conversation of the task first — running the pre-archive
 * command against each live session unless skipped — and only archive the
 * task itself once all conversation archives have completed. The task row
 * stays in the sidebar with an `archivingTaskIds` loading state for the whole
 * flow; each conversation shows its own `isArchiving` state meanwhile.
 */
export async function archiveTaskWithPreCommand(
  projectId: string,
  taskId: string,
  options: ArchiveTaskWithPreCommandOptions
): Promise<void> {
  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) return;

  taskManager.setTaskArchiving(taskId, true);
  try {
    const provisioned = asProvisioned(getTaskStore(projectId, taskId));
    if (provisioned) {
      await provisioned.conversations.load();
      const conversationIds = Array.from(provisioned.conversations.conversations.keys());
      await Promise.all(
        conversationIds.map((conversationId) =>
          archiveConversationWithPreCommand(projectId, taskId, conversationId, {
            preArchiveCommand: options.preArchiveCommand,
            skipPreCommand: options.skipPreCommand,
          })
        )
      );
    }

    await taskManager.archiveTask(taskId, options.note);
  } finally {
    taskManager.setTaskArchiving(taskId, false);
  }
}
