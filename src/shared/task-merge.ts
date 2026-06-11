/**
 * Local quick-merge of a task branch back into its source branch — the
 * "finish" path for worktree tasks that don't go through a pull request.
 * Errors are typed so the renderer can render a precise, actionable message
 * (and offer the smart-merge agent on conflicts) instead of a raw git dump.
 */
export type MergeTaskBranchError =
  | { kind: 'no-task-branch' }
  | { kind: 'no-worktree' }
  | { kind: 'no-base-branch' }
  | { kind: 'nothing-to-merge' }
  /** The project root checkout is not on the task's source branch. */
  | { kind: 'base-not-checked-out'; baseBranch: string; currentBranch: string | null }
  /** The project root checkout has uncommitted changes. */
  | { kind: 'base-dirty'; baseBranch: string }
  | { kind: 'merge-conflict'; baseBranch: string; detail: string }
  | { kind: 'git-error'; detail: string };

export type MergeTaskBranchSuccess = {
  commitHash: string;
  baseBranch: string;
  taskBranch: string;
};
