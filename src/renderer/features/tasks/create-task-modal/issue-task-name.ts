import { deriveTaskSlug } from '@shared/task-name';
import type { Issue } from '@shared/tasks';

export function getIssueTaskName(issue: Issue | null | undefined): string | null {
  if (issue?.provider !== 'linear') {
    return null;
  }

  const branchName = issue.branchName?.trim();
  if (!branchName) {
    return null;
  }

  const normalized = deriveTaskSlug(branchName.replace(/\//g, '-'));
  return normalized || null;
}
