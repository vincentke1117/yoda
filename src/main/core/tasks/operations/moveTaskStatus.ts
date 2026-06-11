import { taskStatusUpdatedChannel } from '@shared/events/taskEvents';
import type { KanbanStatus } from '@shared/kanban';
import type { TaskLifecycleStatus } from '@shared/tasks';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { runKanbanColumnHooks } from './kanban-hooks';
import { updateTaskStatus } from './updateTaskStatus';

/**
 * Kanban drag entrypoint: persist the lifecycle transition, broadcast it to
 * all renderer task stores, then fire the target column's configured hooks.
 * Hooks run in the main process (fire-and-forget) so they survive renderer
 * reloads and can never block or roll back the move itself.
 */
export async function moveTaskStatus(
  projectId: string,
  taskId: string,
  fromStatus: TaskLifecycleStatus,
  status: KanbanStatus
): Promise<void> {
  await updateTaskStatus(taskId, status);
  events.emit(taskStatusUpdatedChannel, { taskId, projectId, status });

  void runKanbanColumnHooks(projectId, taskId, status)
    .then((hookCount) => {
      telemetryService.capture('kanban_task_moved', {
        from_status: fromStatus,
        to_status: status,
        hook_count: hookCount,
      });
    })
    .catch((error: unknown) => {
      log.warn('moveTaskStatus: column hooks failed', { taskId, status, error: String(error) });
    });
}
