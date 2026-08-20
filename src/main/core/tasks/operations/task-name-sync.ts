import { and, eq, sql } from 'drizzle-orm';
import { taskRenamedChannel } from '@shared/events/taskEvents';
import { normalizeTaskDisplayName } from '@shared/task-name';
import { taskEvents } from '@main/core/tasks/task-events';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { events } from '@main/lib/events';

/**
 * A task is its session, so the two names are one name. This mirrors a title
 * the agent reported for the session onto the task row, which is what every
 * surface (sidebar, tabs, window title) actually renders.
 *
 * Only advisory: a task the user named by hand keeps that name forever, and a
 * no-op title is dropped without touching `updatedAt`.
 */
export async function syncTaskNameFromSession(
  projectId: string,
  taskId: string,
  rawName: string
): Promise<void> {
  const displayName = normalizeTaskDisplayName(rawName);
  if (!displayName) return;

  const [updatedRow] = await db
    .update(tasks)
    .set({ name: displayName, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.projectId, projectId),
        eq(tasks.isUserNamed, 0),
        sql`${tasks.name} IS NOT ${displayName}`
      )
    )
    .returning();
  if (!updatedRow) return;

  taskEvents._emit('task:updated', mapTaskRowToTask(updatedRow));
  events.emit(taskRenamedChannel, {
    taskId,
    projectId,
    name: displayName,
    isUserNamed: false,
  });
}
