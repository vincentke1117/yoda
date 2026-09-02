import { useCallback } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';

type ArchiveTaskOptions = {
  note?: string;
  skipPreCommand?: boolean;
  /** One-off pre-archive command override (user-edited in the archive dialog). */
  preArchiveCommand?: string;
  /** Bulk callers set this to avoid spawning one undo toast per task. */
  suppressUndoToast?: boolean;
};

export function useArchiveTask(projectId: string): {
  archiveTask: (taskId: string, options?: ArchiveTaskOptions) => Promise<void>;
  hasPreArchiveCommand: boolean;
} {
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const hasPreArchiveCommand = (homeDraft?.preArchiveCommand ?? '').trim().length > 0;

  const archiveTask = useCallback(
    (taskId: string, options: ArchiveTaskOptions = {}) =>
      archiveTaskOnServer(projectId, taskId, options),
    [projectId]
  );

  return { archiveTask, hasPreArchiveCommand };
}

/**
 * Archive the task via the main-process orchestration (pre-archive command →
 * conversation archives → task archive). The task row keeps an
 * `archivingTaskIds` loading state in the sidebar for the whole flow.
 */
export async function archiveTaskOnServer(
  projectId: string,
  taskId: string,
  options: ArchiveTaskOptions = {}
): Promise<void> {
  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) return;

  taskManager.setTaskArchiving(taskId, true);
  try {
    await taskManager.archiveTask(taskId, options);
  } finally {
    taskManager.setTaskArchiving(taskId, false);
  }
}
