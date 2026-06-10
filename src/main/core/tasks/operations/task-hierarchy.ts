import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

/**
 * All descendant task ids of `taskId` (children, grandchildren, ...), parents
 * before their children. Uses a recursive CTE so arbitrary depth is one query.
 */
export async function getDescendantTaskIds(taskId: string): Promise<string[]> {
  // better-sqlite3 driver: db.all is synchronous despite the async signature.
  const rows = db.all<{ id: string }>(sql`
    WITH RECURSIVE sub(id) AS (
      SELECT id FROM tasks WHERE parent_task_id = ${taskId}
      UNION ALL
      SELECT t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id
    )
    SELECT id FROM sub
  `);
  return rows.map((row) => row.id);
}

/**
 * Whether setting `newParentId` as the parent of `taskId` would create a cycle
 * (i.e. `newParentId` is `taskId` itself or one of its descendants). Walks the
 * parent chain upwards from `newParentId`; bounded by a step limit as a guard
 * against pre-existing bad data.
 */
export async function wouldCreateCycle(taskId: string, newParentId: string): Promise<boolean> {
  let currentId: string | null = newParentId;
  // Generous bound — task trees never get this deep; protects against dirty cycles.
  for (let steps = 0; steps < 10_000 && currentId; steps++) {
    if (currentId === taskId) return true;
    const [row] = await db
      .select({ parentTaskId: tasks.parentTaskId })
      .from(tasks)
      .where(eq(tasks.id, currentId))
      .limit(1);
    currentId = row?.parentTaskId ?? null;
  }
  return false;
}
