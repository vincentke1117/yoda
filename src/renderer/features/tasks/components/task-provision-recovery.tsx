import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getTaskManagerStore,
  getTaskStore,
  taskErrorMessage,
} from '@renderer/features/tasks/stores/task-selectors';
import { Button } from '@renderer/lib/ui/button';
import { log } from '@renderer/utils/logger';

/**
 * Recovery panel for a task whose workspace provisioning failed
 * (`provision-error` / `project-error`). The task is already named and its
 * branch resolved — only the worktree/project mount failed — so retrying just
 * re-runs `provisionTask`, which remounts the project then re-provisions.
 *
 * Shared between the in-app main panel and the popped-out task window so the
 * failure surface behaves identically everywhere (see agents/conventions/reuse.md).
 */
export const TaskProvisionRecovery = observer(function TaskProvisionRecovery({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const [isRetrying, setIsRetrying] = useState(false);
  const taskStore = getTaskStore(projectId, taskId);
  const taskManager = getTaskManagerStore(projectId);
  const errorMessage = taskErrorMessage(taskStore);

  const retry = () => {
    if (!taskManager || isRetrying) return;
    setIsRetrying(true);
    void taskManager
      .provisionTask(taskId)
      .catch((error: unknown) => {
        // The store already surfaces the failure via provision-error; this is
        // only to keep the rejection from going unhandled.
        log.warn('TaskProvisionRecovery: retry failed', { projectId, taskId, error });
      })
      .finally(() => setIsRetrying(false));
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium text-foreground-destructive">
          {t('tasks.failedSetUpWorkspace')}
        </p>
        <p className="text-xs text-foreground-muted">{errorMessage}</p>
        <Button size="sm" variant="outline" disabled={isRetrying} onClick={retry}>
          {isRetrying ? t('common.loading') : t('tasks.retryTaskSetup')}
        </Button>
      </div>
    </div>
  );
});
