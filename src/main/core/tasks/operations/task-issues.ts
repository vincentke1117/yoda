import { asc, eq, inArray } from 'drizzle-orm';
import type { Issue } from '@shared/tasks';
import { issueRecordToIssue, upsertIssueRecords } from '@main/core/issues/issue-records';
import { db } from '@main/db/client';
import { issueRecords, taskIssueLinks, tasks, type TaskRow } from '@main/db/schema';

export async function replaceTaskIssueLinks(taskId: string, issues: Issue[]): Promise<TaskRow[]> {
  const unique = await upsertIssueRecords(issues);

  await db.delete(taskIssueLinks).where(eq(taskIssueLinks.taskId, taskId));

  if (unique.length > 0) {
    await db
      .insert(taskIssueLinks)
      .values(unique.map((issue) => ({ taskId, issueUrl: issue.url })))
      .onConflictDoNothing();
  }

  return db
    .update(tasks)
    .set({
      linkedIssue: unique[0] ? JSON.stringify(unique[0]) : null,
    })
    .where(eq(tasks.id, taskId))
    .returning();
}

export async function getIssuesForTasks(taskIds: string[]): Promise<Map<string, Issue[]>> {
  const map = new Map<string, Issue[]>();
  if (taskIds.length === 0) return map;

  const rows = await db
    .select({
      taskId: taskIssueLinks.taskId,
      issue: issueRecords,
    })
    .from(taskIssueLinks)
    .innerJoin(issueRecords, eq(taskIssueLinks.issueUrl, issueRecords.url))
    .where(inArray(taskIssueLinks.taskId, taskIds))
    .orderBy(asc(taskIssueLinks.createdAt));

  for (const row of rows) {
    const issues = map.get(row.taskId) ?? [];
    issues.push(issueRecordToIssue(row.issue));
    map.set(row.taskId, issues);
  }

  return map;
}
