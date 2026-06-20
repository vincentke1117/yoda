import { eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type { MoveTaskToProjectError, Task } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { taskEvents } from '@main/core/tasks/task-events';
import { taskManager } from '@main/core/tasks/task-manager';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import {
  conversations,
  projects,
  reviewOrchestrations,
  taskNamingSnapshots,
  tasks,
  teamRooms,
  terminals,
} from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

/**
 * Re-home a task under a different project ("move", or "promote" a projectless
 * Default task into a real project). Lightweight by design: only no-worktree
 * leaf tasks are eligible, so there is no worktree/branch to migrate — we just
 * reassign `projectId` across the task and its task-scoped rows. The task drops
 * its old workspace/parent bindings and re-provisions fresh in the destination
 * (its prior on-disk agent transcript, keyed by working directory, does not
 * follow — the caller warns the user).
 */
export async function moveTaskToProject(
  taskId: string,
  targetProjectId: string
): Promise<Result<Task, MoveTaskToProjectError>> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return err({ type: 'task-not-found' });
  if (task.projectId === targetProjectId) return err({ type: 'same-project' });

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, targetProjectId))
    .limit(1);
  if (!project) return err({ type: 'project-not-found' });

  // Only no-worktree leaf tasks: a branch worktree lives inside the source
  // project's git dir and a subtree would straddle two projects — both are the
  // heavier "full move" not covered here.
  if (task.taskBranch) return err({ type: 'has-worktree' });
  const [child] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.parentTaskId, taskId))
    .limit(1);
  if (child) return err({ type: 'has-subtasks' });

  // Stop any live session running in the old project context before the rows
  // move; the task re-provisions on demand in the destination.
  if (projectManager.getProject(task.projectId)) {
    const teardown = await taskManager.teardownTask(taskId, 'terminate').catch((e) => {
      log.warn('moveTaskToProject: teardown failed', { taskId, error: String(e) });
      return null;
    });
    if (teardown && !teardown.success) {
      log.warn('moveTaskToProject: teardown failed', { taskId, error: teardown.error.message });
    }
  }

  // Reassign the task and every task-scoped row that carries its own projectId,
  // so per-(project, task) lookups resolve under the new project.
  await db
    .update(tasks)
    .set({
      projectId: targetProjectId,
      parentTaskId: null,
      sidebarWorkspaceId: null,
      workspaceId: null,
      workspaceProviderData: null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
  await db
    .update(conversations)
    .set({ projectId: targetProjectId })
    .where(eq(conversations.taskId, taskId));
  await db
    .update(terminals)
    .set({ projectId: targetProjectId })
    .where(eq(terminals.taskId, taskId));
  await db
    .update(taskNamingSnapshots)
    .set({ projectId: targetProjectId })
    .where(eq(taskNamingSnapshots.taskId, taskId));
  await db
    .update(reviewOrchestrations)
    .set({ projectId: targetProjectId })
    .where(eq(reviewOrchestrations.taskId, taskId));
  await db
    .update(teamRooms)
    .set({ projectId: targetProjectId })
    .where(eq(teamRooms.taskId, taskId));

  const [updatedRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const updated = mapTaskRowToTask(updatedRow);
  taskEvents._emit('task:updated', updated);
  telemetryService.capture('task_moved_to_project', {
    task_id: taskId,
    from_project_id: task.projectId,
    to_project_id: targetProjectId,
  });
  return ok(updated);
}
