import { eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type { SetTaskParentError, Task } from '@shared/tasks';
import { taskEvents } from '@main/core/tasks/task-events';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { wouldCreateCycle } from './task-hierarchy';

export async function setTaskParent(
  projectId: string,
  taskId: string,
  parentTaskId: string | null
): Promise<Result<Task, SetTaskParentError>> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || task.projectId !== projectId) return err({ type: 'task-not-found' });

  if (parentTaskId !== null) {
    const [parent] = await db.select().from(tasks).where(eq(tasks.id, parentTaskId)).limit(1);
    if (!parent) return err({ type: 'parent-not-found' });
    if (parent.projectId !== task.projectId) return err({ type: 'cross-project' });
    if (parent.archivedAt) return err({ type: 'parent-archived' });
    if (await wouldCreateCycle(taskId, parentTaskId)) return err({ type: 'cycle-detected' });
  }

  const [updatedRow] = await db
    .update(tasks)
    .set({
      parentTaskId,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId))
    .returning();

  const updated = mapTaskRowToTask(updatedRow);
  taskEvents._emit('task:updated', updated);
  return ok(updated);
}
