import type { Issue } from '@shared/tasks';
import { db } from '@main/db/client';
import { issueRecords, type IssueRecordInsert, type IssueRecordRow } from '@main/db/schema';

function issueToInsert(issue: Issue): IssueRecordInsert {
  return {
    url: issue.url,
    provider: issue.provider,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    branchName: issue.branchName ?? null,
    status: issue.status ?? null,
    assignees: issue.assignees ?? null,
    project: issue.project ?? null,
    updatedAt: issue.updatedAt ?? null,
    fetchedAt: issue.fetchedAt ?? null,
  };
}

export function issueRecordToIssue(row: IssueRecordRow): Issue {
  return {
    provider: row.provider as Issue['provider'],
    url: row.url,
    title: row.title,
    identifier: row.identifier,
    description: row.description ?? undefined,
    branchName: row.branchName ?? undefined,
    status: row.status ?? undefined,
    assignees: row.assignees ?? undefined,
    project: row.project ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
    fetchedAt: row.fetchedAt ?? undefined,
  };
}

function uniqueIssues(issues: Issue[]): Issue[] {
  const byUrl = new Map<string, Issue>();
  for (const issue of issues) {
    if (!issue.url.trim()) continue;
    byUrl.set(issue.url, issue);
  }
  return [...byUrl.values()];
}

/** Shared issue-record write path for Task and Feature relationships. */
export async function upsertIssueRecords(issues: Issue[]): Promise<Issue[]> {
  const unique = uniqueIssues(issues);

  for (const issue of unique) {
    const row = issueToInsert(issue);
    await db
      .insert(issueRecords)
      .values(row)
      .onConflictDoUpdate({
        target: issueRecords.url,
        set: {
          provider: row.provider,
          identifier: row.identifier,
          title: row.title,
          description: row.description,
          branchName: row.branchName,
          status: row.status,
          assignees: row.assignees,
          project: row.project,
          updatedAt: row.updatedAt,
          fetchedAt: row.fetchedAt,
        },
      });
  }

  return unique;
}
