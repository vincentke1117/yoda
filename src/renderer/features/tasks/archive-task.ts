import { useCallback } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  getTaskMenuConversation,
  selectPreferredConversation,
} from '@renderer/features/tasks/components/task-menu-session-info';
import { runPreArchiveCommand } from '@renderer/features/tasks/run-pre-archive-command';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';

type ArchiveTaskOptions = {
  note?: string;
  skipPreCommand?: boolean;
};

type ArchiveTaskWithPreCommandOptions = ArchiveTaskOptions & {
  preArchiveCommand: string;
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

export async function archiveTaskWithPreCommand(
  projectId: string,
  taskId: string,
  options: ArchiveTaskWithPreCommandOptions
): Promise<void> {
  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) return;

  if (!options.skipPreCommand && options.preArchiveCommand.trim().length > 0) {
    const conversationId = await resolvePreArchiveConversationId(projectId, taskId);
    if (conversationId) {
      await runPreArchiveCommand(projectId, taskId, conversationId, options.preArchiveCommand);
    }
  }

  await taskManager.archiveTask(taskId, options.note);
}

async function resolvePreArchiveConversationId(
  projectId: string,
  taskId: string
): Promise<string | undefined> {
  const task = getTaskStore(projectId, taskId);
  const provisioned = asProvisioned(task);
  if (!provisioned) return undefined;

  const loadedConversation = getTaskMenuConversation(provisioned);
  if (loadedConversation) return loadedConversation.id;

  try {
    const conversations = await rpc.conversations.getConversationsForTask(projectId, taskId);
    return selectPreferredConversation(conversations)?.id;
  } catch (error) {
    log.warn('resolvePreArchiveConversationId failed', {
      projectId,
      taskId,
      error: String(error),
    });
    return undefined;
  }
}
