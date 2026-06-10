import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { RestoreTaskResult } from '@shared/tasks';
import { taskEvents } from '@main/core/tasks/task-events';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { getDescendantTaskIds } from './task-hierarchy';

export async function restoreTask(id: string): Promise<RestoreTaskResult> {
  // Cascade: restore the task plus all archived descendants. Ancestors are
  // left untouched — the sidebar promotes orphaned subtrees at display time.
  const descendantIds = await getDescendantTaskIds(id);
  const restoredTaskIds: string[] = [];

  await restoreSingleTask(id, restoredTaskIds);

  if (descendantIds.length > 0) {
    const archivedDescendants = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(inArray(tasks.id, descendantIds), isNotNull(tasks.archivedAt)));
    const archivedIds = new Set(archivedDescendants.map((d) => d.id));
    // descendantIds is parents-before-children — restore top-down.
    for (const descendantId of descendantIds) {
      if (!archivedIds.has(descendantId)) continue;
      await restoreSingleTask(descendantId, restoredTaskIds);
    }
  }

  return { restoredTaskIds };
}

async function restoreSingleTask(id: string, restoredTaskIds: string[]): Promise<void> {
  const [updatedRow] = await db
    .update(tasks)
    .set({
      archivedAt: null,
      archiveRequestedAt: null,
      status: 'in_progress',
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, id))
    .returning();

  if (updatedRow) {
    restoredTaskIds.push(updatedRow.id);
    taskEvents._emit('task:updated', mapTaskRowToTask(updatedRow));
  }
}
