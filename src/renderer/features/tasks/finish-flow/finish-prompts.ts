/**
 * Canned prompts for the finish-flow agent sessions. Prompts are English on
 * purpose — they address the agent CLI, not the user.
 */

/** Acceptance review: verify the branch work fulfills the task before merging. */
export function buildAcceptanceReviewPrompt(input: {
  taskName: string;
  taskBranch: string;
  baseBranch: string;
}): string {
  return [
    `You are reviewing the work on branch "${input.taskBranch}" before it gets squash-merged into "${input.baseBranch}".`,
    `The task was: ${input.taskName}`,
    '',
    'Do an acceptance review:',
    `1. Inspect the full diff against ${input.baseBranch} (\`git diff ${input.baseBranch}\`) and walk through every change.`,
    '2. Check the changes actually accomplish the task — not just that they compile.',
    '3. Run the cheapest meaningful verification available (typecheck, lint, focused tests).',
    '4. Look for leftovers: debug logging, dead code, TODOs introduced by this work.',
    '',
    'Finish with a clear verdict: PASS (safe to merge) or FAIL, followed by a short list of findings ordered by severity. Do not fix anything unless asked.',
  ].join('\n');
}

/**
 * Smart merge: the local squash into the base branch hit conflicts, so bring
 * the base branch into the task branch and resolve there — after this the
 * quick merge can be retried cleanly.
 */
export function buildSmartMergePrompt(input: {
  taskBranch: string;
  baseBranch: string;
  conflictDetail: string;
}): string {
  return [
    `Squash-merging branch "${input.taskBranch}" into "${input.baseBranch}" failed with conflicts:`,
    '',
    '```',
    input.conflictDetail.trim(),
    '```',
    '',
    'Resolve this from inside the current worktree:',
    `1. Commit any uncommitted work first.`,
    `2. Run \`git merge ${input.baseBranch}\` to bring the base branch into this branch.`,
    '3. Resolve every conflict, preserving the intent of BOTH sides — explain any judgment calls.',
    '4. Complete the merge commit and verify the project still builds (typecheck or equivalent).',
    '',
    'When done, summarize which files conflicted and how each was resolved. The user will then retry the quick merge.',
  ].join('\n');
}
