import { eq, sql } from 'drizzle-orm';
import { branchRef, localRef, mergeBaseRange, type GitChange } from '@shared/git';
import type { TaskDiffStatsSource } from '@shared/stats';
import { resolveWorkspace, withTimeout } from '@main/core/projects/utils';
import { taskManager } from '@main/core/tasks/task-manager';
import { db } from '@main/db/client';
import { tasks, type TaskRow } from '@main/db/schema';
import { log } from '@main/lib/logger';

const LIVE_DIFF_TIMEOUT_MS = 5_000;

export type TaskDiffTotals = { additions: number; deletions: number };

/**
 * Total code delta produced by a task, paradigm-agnostic: committed work
 * (merge-base diff `source...taskBranch`) plus staged + unstaged working-tree
 * changes — users may never commit, push, or PR. Null when the workspace is
 * not provisioned (worktree gone) or git fails.
 */
export async function getLiveTaskDiffTotals(task: TaskRow): Promise<TaskDiffTotals | null> {
  const workspaceId = taskManager.getWorkspaceId(task.id);
  if (!workspaceId) return null;
  const env = resolveWorkspace(task.projectId, workspaceId);
  if (!env) return null;

  try {
    const committed: Promise<GitChange[]> =
      task.taskBranch && task.sourceBranch
        ? env.git.getChangedFiles(
            mergeBaseRange(branchRef(task.sourceBranch), localRef(task.taskBranch))
          )
        : Promise.resolve([]);
    const [fullStatus, committedChanges] = await withTimeout(
      Promise.all([env.git.getFullStatus(), committed]),
      LIVE_DIFF_TIMEOUT_MS
    );
    return sumChanges([...fullStatus.staged, ...fullStatus.unstaged, ...committedChanges]);
  } catch (e) {
    log.warn('stats: live task diff failed', { taskId: task.id, error: String(e) });
    return null;
  }
}

/**
 * Persist the current live totals onto the task row. Keeps the previous
 * snapshot when the live computation is unavailable. Safe to fire-and-forget.
 */
export async function snapshotTaskDiffTotals(taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;
  const totals = await getLiveTaskDiffTotals(task);
  if (!totals) return;
  await db
    .update(tasks)
    .set({
      diffAdditions: totals.additions,
      diffDeletions: totals.deletions,
      diffCapturedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
}

export async function getTaskDiffTotals(
  task: TaskRow
): Promise<{ totals: TaskDiffTotals; source: TaskDiffStatsSource }> {
  const live = await getLiveTaskDiffTotals(task);
  if (live) return { totals: live, source: 'live' };
  return getStoredTaskDiffTotals(task);
}

/**
 * Read the last lifecycle snapshot without touching a workspace. Global usage
 * rollups call this for every historical task; launching live Git work for all
 * mounted tasks at once can exhaust the Electron main process.
 */
export function getStoredTaskDiffTotals(task: TaskRow): {
  totals: TaskDiffTotals;
  source: TaskDiffStatsSource;
} {
  if (task.diffAdditions !== null || task.diffDeletions !== null) {
    return {
      totals: { additions: task.diffAdditions ?? 0, deletions: task.diffDeletions ?? 0 },
      source: 'snapshot',
    };
  }
  return { totals: { additions: 0, deletions: 0 }, source: 'none' };
}

function sumChanges(changes: GitChange[]): TaskDiffTotals {
  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    additions += change.additions;
    deletions += change.deletions;
  }
  return { additions, deletions };
}
