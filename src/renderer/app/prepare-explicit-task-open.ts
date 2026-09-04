import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';

/**
 * Mounts and point-loads a task before an explicit open.
 *
 * A task archive owns its conversation archives too. Restore that complete
 * entity before any caller provisions or resolves a session target; otherwise
 * the task view is ready with an empty active-conversation snapshot.
 */
export async function prepareExplicitTaskOpen(projectId: string, taskId: string): Promise<void> {
  const projectManager = getProjectManagerStore();
  const projectLoaded = await projectManager.ensureProjectLoaded(projectId);
  if (!projectLoaded) throw new Error(`Project ${projectId} could not be loaded`);
  await projectManager.mountProject(projectId);

  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) throw new Error(`Project ${projectId} could not be mounted`);
  const taskLoaded = await taskManager.ensureTaskLoaded(taskId);
  if (!taskLoaded) throw new Error(`Task ${taskId} could not be loaded`);

  const task = taskManager.tasks.get(taskId);
  if (!task || task.state === 'unregistered') throw new Error(`Task ${taskId} could not be loaded`);
  if ('archivedAt' in task.data && task.data.archivedAt) {
    await taskManager.restoreTask(taskId);
  }

  // A persisted `pending` row means task creation stopped after saving its
  // setup payload but before branch setup and the initial conversation were
  // completed. `provisionTask` deliberately rejects that state; resume the
  // idempotent setup workflow first so an old archived task can materialize
  // the session the user originally created it with.
  const preparedTask = taskManager.tasks.get(taskId);
  if (preparedTask?.state === 'unprovisioned' && preparedTask.data.setupStatus === 'pending') {
    await taskManager.retryTaskSetup(taskId);
  }
}
