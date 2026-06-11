import { eq, sql } from 'drizzle-orm';
import { taskRenamedChannel } from '@shared/events/taskEvents';
import { err, ok, type Result } from '@shared/result';
import type { CreateTaskError, CreateTaskParams, Task } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { generateTaskNames } from '@main/core/tasks/name-generation/task-naming-service';
import { taskEvents } from '@main/core/tasks/task-events';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { fromStoredBranch } from '../stored-branch';
import { mapTaskRowToTask } from '../utils/utils';

export async function regenerateTaskName(
  projectId: string,
  taskId: string
): Promise<Result<Task, CreateTaskError>> {
  const startedAt = Date.now();
  console.log('[DEBUG][regenerate-task-name] entry:', { projectId, taskId });
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  console.log('[DEBUG][regenerate-task-name] db row loaded:', {
    projectId,
    taskId,
    durationMs: Date.now() - startedAt,
    found: Boolean(row),
    setupDataLength: row?.setupData?.length ?? 0,
    taskBranch: row?.taskBranch ?? null,
  });
  if (!row) return err({ type: 'project-not-found' });
  const project = projectManager.getProject(projectId);
  if (!project) {
    console.log('[DEBUG][regenerate-task-name] project missing:', {
      projectId,
      taskId,
      durationMs: Date.now() - startedAt,
    });
    return err({ type: 'project-not-found' });
  }

  const parsedSetupParams = parseSetupParams(row.setupData);
  const params = parsedSetupParams ?? {
    id: taskId,
    projectId,
    name: row.name,
    sourceBranch: row.sourceBranch
      ? fromStoredBranch(row.sourceBranch)
      : { type: 'local' as const, branch: row.taskBranch ?? 'main' },
    strategy: row.taskBranch
      ? { kind: 'checkout-existing' as const }
      : { kind: 'no-worktree' as const },
  };
  console.log('[DEBUG][regenerate-task-name] params ready:', {
    projectId,
    taskId,
    durationMs: Date.now() - startedAt,
    fromSetupData: Boolean(parsedSetupParams),
    strategyKind: params.strategy.kind,
    hasInitialPrompt: Boolean(params.initialConversation?.initialPrompt),
  });

  const namingStartedAt = Date.now();
  // Aggregate task naming: the task's session titles + summaries are the
  // primary signal (target 'task'); the branch is never renamed along the way.
  const naming = await generateTaskNames({
    taskId,
    projectId,
    project,
    params,
    includeBranchName: false,
    target: 'task',
  });
  console.log('[DEBUG][regenerate-task-name] generateTaskNames result:', {
    projectId,
    taskId,
    success: naming.success,
    durationMs: Date.now() - namingStartedAt,
    totalDurationMs: Date.now() - startedAt,
    taskName: naming.success ? naming.taskName : undefined,
    branchName: naming.success ? naming.branchName : undefined,
    error: naming.success ? undefined : naming.message,
  });
  if (!naming.success || !naming.taskName) {
    console.log('[DEBUG][regenerate-task-name] exit without update:', {
      projectId,
      taskId,
      totalDurationMs: Date.now() - startedAt,
    });
    return ok(mapTaskRowToTask(row));
  }

  const displayName = naming.taskName;
  const updateStartedAt = Date.now();
  const [updatedRow] = await db
    .update(tasks)
    .set({
      name: displayName,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  console.log('[DEBUG][regenerate-task-name] db update complete:', {
    projectId,
    taskId,
    durationMs: Date.now() - updateStartedAt,
    totalDurationMs: Date.now() - startedAt,
    updated: Boolean(updatedRow),
  });
  const task = mapTaskRowToTask(updatedRow ?? row);
  taskEvents._emit('task:updated', task);
  events.emit(taskRenamedChannel, {
    taskId,
    projectId,
    name: displayName,
    isUserNamed: task.isUserNamed,
  });
  console.log('[DEBUG][regenerate-task-name] exit success:', {
    projectId,
    taskId,
    totalDurationMs: Date.now() - startedAt,
  });
  return ok(task);
}

function parseSetupParams(value: string | null): CreateTaskParams | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { params?: CreateTaskParams };
    return parsed.params ?? null;
  } catch {
    return null;
  }
}
