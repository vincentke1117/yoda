import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { ParadigmStamp } from '@shared/paradigms/stamp';
import type { CreateSiblingTaskParams, CreateSiblingTaskResult } from '@shared/tasks';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { createTask } from './createTask';
import { resolveDerivedTaskTarget } from './derived-task-target';

/**
 * Starts a second agent on the work a task is already doing.
 *
 * A task is its session, so "run an acceptance review on this" is a subtask, not
 * a second session under the source. It shares the source's branch and worktree
 * by refcount — the review or merge agent must see the same tree — and hangs off
 * it as a subtask so the sidebar shows where it came from.
 */
export async function createSiblingTask(
  params: CreateSiblingTaskParams
): Promise<CreateSiblingTaskResult> {
  const [sourceRow] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, params.taskId), eq(tasks.projectId, params.projectId)))
    .limit(1);
  if (!sourceRow) throw new Error(`Task not found: ${params.taskId}`);
  const sourceTask = mapTaskRowToTask(sourceRow);

  const { strategy, sourceBranch } = await resolveDerivedTaskTarget(
    params.projectId,
    sourceTask,
    'same-branch'
  );
  const paradigm: ParadigmStamp | undefined =
    sourceTask.paradigmId && sourceTask.paradigmKind
      ? {
          paradigmId: sourceTask.paradigmId,
          paradigmKind: sourceTask.paradigmKind,
          paradigmParams: sourceTask.paradigmParams,
        }
      : undefined;

  const taskId = randomUUID();
  const conversationId = randomUUID();
  const created = await createTask({
    id: taskId,
    projectId: params.projectId,
    name: params.name,
    nameIsExplicit: true,
    sourceBranch,
    strategy,
    parentTaskId: params.taskId,
    ...(paradigm ? { paradigm } : {}),
    initialConversation: {
      id: conversationId,
      projectId: params.projectId,
      taskId,
      runtime: params.runtime,
      title: params.name,
      initialPrompt: params.initialPrompt,
    },
  });
  if (!created.success) {
    throw new Error(`Sibling task creation failed: ${JSON.stringify(created.error)}`);
  }
  if (created.data.warning?.type === 'branch-setup-failed') {
    throw new Error(`Sibling task could not reach its branch: ${created.data.warning.message}`);
  }
  return { task: created.data.task, conversationId };
}
