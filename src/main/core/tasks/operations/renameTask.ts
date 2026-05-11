import { and, eq, sql } from 'drizzle-orm';
import { deriveTaskSlug, normalizeTaskDisplayName } from '@shared/task-name';
import { projectManager } from '@main/core/projects/project-manager';
import { taskEvents } from '@main/core/tasks/task-events';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { appSettingsService } from '../../settings/settings-service';

export async function renameTask(
  projectId: string,
  taskId: string,
  newName: string
): Promise<void> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) throw new Error(`Task not found: ${taskId}`);

  const project = projectManager.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const displayName = normalizeTaskDisplayName(newName);
  if (!displayName) throw new Error('Task name cannot be empty');

  const oldBranch = row.taskBranch;
  const sourceBranch = row.sourceBranch ?? undefined;
  let newBranch: string | null = null;

  if (oldBranch) {
    if (sourceBranch && oldBranch !== sourceBranch.branch) {
      const siblings = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, row.projectId), eq(tasks.taskBranch, oldBranch)))
        .limit(2);

      if (siblings.length === 1) {
        const branchSlug = deriveTaskSlug(displayName);
        if (branchSlug) {
          const suffix = Math.random().toString(36).slice(2, 7);
          const branchPrefix = (await appSettingsService.get('project')).branchPrefix ?? '';
          newBranch = branchPrefix
            ? `${branchPrefix}/${branchSlug}-${suffix}`
            : `${branchSlug}-${suffix}`;

          await project.repository.renameBranch(oldBranch, newBranch);
        }
      }
    }
  }

  const [updatedRow] = await db
    .update(tasks)
    .set({
      name: displayName,
      taskBranch: newBranch ?? row.taskBranch,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId))
    .returning();

  if (updatedRow) {
    taskEvents._emit('task:updated', mapTaskRowToTask(updatedRow));
  }
}
