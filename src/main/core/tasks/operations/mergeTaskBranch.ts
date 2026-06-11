import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type { MergeTaskBranchError, MergeTaskBranchSuccess } from '@shared/task-merge';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { fromStoredBranch } from '../stored-branch';

/** execFile rejections carry stderr/stdout — surface those over the bare message. */
function gitErrorDetail(e: unknown): string {
  const error = e as { stderr?: string; stdout?: string; message?: string };
  return (
    [error.stderr?.trim(), error.stdout?.trim()].filter(Boolean).join('\n') ||
    error.message ||
    String(e)
  );
}

/**
 * Squash-merge a worktree task's branch back into its source branch in the
 * project's root checkout — the local "finish" path that skips a PR.
 *
 * Uncommitted work in the task worktree is committed first (agents often
 * leave the worktree dirty), then the root checkout is validated (on the
 * source branch, clean) before `merge --squash` + commit. A conflicted squash
 * is rolled back with `reset --merge` so the root checkout never stays
 * half-merged.
 */
export async function mergeTaskBranch(
  projectId: string,
  taskId: string,
  options: { commitMessage: string }
): Promise<Result<MergeTaskBranchSuccess, MergeTaskBranchError>> {
  const message = options.commitMessage.trim();
  if (!message) return err({ kind: 'git-error', detail: 'Commit message is empty.' });

  const [task] = await db
    .select({ taskBranch: tasks.taskBranch, sourceBranch: tasks.sourceBranch })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!task?.taskBranch) return err({ kind: 'no-task-branch' });
  const taskBranch = task.taskBranch;

  const source = task.sourceBranch ? fromStoredBranch(task.sourceBranch) : undefined;
  if (!source || source.type !== 'local') return err({ kind: 'no-base-branch' });
  const baseBranch = source.branch;

  const project = projectManager.getProject(projectId);
  if (!project) return err({ kind: 'git-error', detail: 'Project is not open.' });

  const worktreePath = await project.getWorktreeForBranch(taskBranch);
  if (!worktreePath) return err({ kind: 'no-worktree' });

  const git = (args: string[]) => project.ctx.exec('git', args);

  // 1) Commit any uncommitted work in the task worktree so the squash sees it.
  try {
    const { stdout } = await git(['-C', worktreePath, 'status', '--porcelain']);
    if (stdout.trim()) {
      await git(['-C', worktreePath, 'add', '-A']);
      await git(['-C', worktreePath, 'commit', '-m', message]);
    }
  } catch (e) {
    return err({ kind: 'git-error', detail: gitErrorDetail(e) });
  }

  try {
    // 2) Anything to merge at all?
    const { stdout: aheadCount } = await git([
      '-C',
      project.repoPath,
      'rev-list',
      '--count',
      `${baseBranch}..${taskBranch}`,
    ]);
    if (aheadCount.trim() === '0') return err({ kind: 'nothing-to-merge' });

    // 3) The root checkout must be on the source branch and clean — we refuse
    //    to switch branches or touch the user's working tree behind their back.
    const { stdout: head } = await git([
      '-C',
      project.repoPath,
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ]);
    const currentBranch = head.trim();
    if (currentBranch !== baseBranch) {
      return err({
        kind: 'base-not-checked-out',
        baseBranch,
        currentBranch: currentBranch || null,
      });
    }
    const { stdout: rootStatus } = await git(['-C', project.repoPath, 'status', '--porcelain']);
    if (rootStatus.trim()) return err({ kind: 'base-dirty', baseBranch });
  } catch (e) {
    return err({ kind: 'git-error', detail: gitErrorDetail(e) });
  }

  // 4) Squash merge + commit.
  try {
    await git(['-C', project.repoPath, 'merge', '--squash', taskBranch]);
  } catch (e) {
    // A conflicted squash leaves the index conflicted — roll it back.
    await git(['-C', project.repoPath, 'reset', '--merge']).catch((resetError: unknown) => {
      log.warn('mergeTaskBranch: reset after conflict failed', {
        taskId,
        error: String(resetError),
      });
    });
    telemetryService.capture('task_branch_merged', {
      project_id: projectId,
      task_id: taskId,
      success: false,
      error_type: 'merge_conflict',
    });
    return err({ kind: 'merge-conflict', baseBranch, detail: gitErrorDetail(e) });
  }

  try {
    await git(['-C', project.repoPath, 'commit', '-m', message]);
    const { stdout: hash } = await git(['-C', project.repoPath, 'rev-parse', 'HEAD']);
    telemetryService.capture('task_branch_merged', {
      project_id: projectId,
      task_id: taskId,
      success: true,
    });
    return ok({ commitHash: hash.trim(), baseBranch, taskBranch });
  } catch (e) {
    await git(['-C', project.repoPath, 'reset', '--merge']).catch(() => undefined);
    return err({ kind: 'git-error', detail: gitErrorDetail(e) });
  }
}
