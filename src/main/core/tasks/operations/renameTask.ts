import { eq, sql } from 'drizzle-orm';
import { taskRenamedChannel } from '@shared/events/taskEvents';
import { normalizeTaskDisplayName } from '@shared/task-name';
import { renameConversation } from '@main/core/conversations/renameConversation';
import { projectManager } from '@main/core/projects/project-manager';
import { taskEvents } from '@main/core/tasks/task-events';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { renameTaskBranchForName } from './taskBranchRename';

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

  const branchRename = await renameTaskBranchForName({
    project,
    projectId,
    taskId,
    oldBranch: row.taskBranch,
    sourceBranch: row.sourceBranch,
    displayName,
  });
  if (!branchRename.success) throw new Error(branchRename.error);

  const [updatedRow] = await db
    .update(tasks)
    .set({
      name: displayName,
      isUserNamed: 1,
      taskBranch: branchRename.data ?? row.taskBranch,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId))
    .returning();

  // A task is its session, so one rename names both. Mirroring it as 'user'
  // also pins the title against the provider CLI's interim auto-titles.
  const sessionRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.taskId, taskId));
  for (const session of sessionRows) {
    await renameConversation(session.id, displayName, 'user');
  }

  if (updatedRow) {
    taskEvents._emit('task:updated', mapTaskRowToTask(updatedRow));
    events.emit(taskRenamedChannel, {
      taskId,
      projectId,
      name: displayName,
      isUserNamed: true,
    });
  }
}
