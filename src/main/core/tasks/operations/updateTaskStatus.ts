import { and, eq, sql } from 'drizzle-orm';
import type { FeatureStageId } from '@shared/features';
import { type TaskLifecycleStatus } from '@shared/tasks';
import { snapshotTaskDiffTotals } from '@main/core/stats/task-diff-snapshot';
import { db } from '@main/db/client';
import { features, featureTaskLinks, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

export async function updateTaskStatus(taskId: string, status: TaskLifecycleStatus): Promise<void> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) throw new Error(`Task not found: ${taskId}`);
  if (row.status === status) return;

  await db
    .update(tasks)
    .set({
      status,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));

  // Capture diff totals at every transition so done/archived tasks keep
  // their stats once the worktree disappears.
  void snapshotTaskDiffTotals(taskId).catch((e: unknown) => {
    log.warn('updateTaskStatus: diff snapshot failed', { taskId, error: String(e) });
  });

  telemetryService.capture('task_status_changed', {
    from_status: row.status as TaskLifecycleStatus,
    to_status: status,
    project_id: row.projectId,
    task_id: row.id,
  });
}

/**
 * Feature hand-offs need a final aggregate guard in the same transaction as the
 * Task transition; otherwise a cancellation racing the Agent reply could still
 * move the Task to review.
 */
export async function updateTaskStatusForActiveFeatureHandoff(args: {
  projectId: string;
  featureId: string;
  featureStage: FeatureStageId;
  taskId: string;
  status: TaskLifecycleStatus;
}): Promise<boolean> {
  const previous = db.transaction((tx) => {
    const feature = tx
      .select({ status: features.status, stage: features.stage })
      .from(features)
      .where(and(eq(features.id, args.featureId), eq(features.projectId, args.projectId)))
      .limit(1)
      .get();
    if (!feature) throw new Error(`Feature not found: ${args.featureId}`);
    if (feature.status !== 'active' || feature.stage !== args.featureStage) {
      throw new Error('Feature changed while the Agent hand-off was being accepted.');
    }
    const link = tx
      .select({ taskId: featureTaskLinks.taskId })
      .from(featureTaskLinks)
      .where(
        and(
          eq(featureTaskLinks.featureId, args.featureId),
          eq(featureTaskLinks.taskId, args.taskId)
        )
      )
      .limit(1)
      .get();
    if (!link) throw new Error('The workflow Task is no longer linked to this Feature.');
    const task = tx
      .select({ id: tasks.id, projectId: tasks.projectId, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, args.taskId))
      .limit(1)
      .get();
    if (!task) throw new Error(`Task not found: ${args.taskId}`);
    if (task.status === 'cancelled') throw new Error('A cancelled Task cannot enter review.');
    if (args.status === 'review') {
      if (task.status === 'review' || task.status === 'done') return null;
      if (task.status !== 'todo' && task.status !== 'in_progress') {
        throw new Error(`Task status ${task.status} cannot enter review.`);
      }
    } else if (task.status === args.status) {
      return null;
    }

    tx.update(tasks)
      .set({
        status: args.status,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        statusChangedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(tasks.id, args.taskId))
      .run();
    return task;
  });
  if (!previous) return false;

  void snapshotTaskDiffTotals(args.taskId).catch((e: unknown) => {
    log.warn('updateTaskStatusForActiveFeatureHandoff: diff snapshot failed', {
      taskId: args.taskId,
      error: String(e),
    });
  });
  telemetryService.capture('task_status_changed', {
    from_status: previous.status as TaskLifecycleStatus,
    to_status: args.status,
    project_id: previous.projectId,
    task_id: previous.id,
  });
  return true;
}
