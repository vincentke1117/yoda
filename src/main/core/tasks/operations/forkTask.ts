import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Branch } from '@shared/git';
import type { ParadigmStamp } from '@shared/paradigms/stamp';
import type {
  CreateTaskStrategy,
  ForkTaskCheckpoint,
  ForkTaskParams,
  ForkTaskResult,
} from '@shared/tasks';
import { forkSessionIntoTask } from '@main/core/conversations/forkSessionIntoTask';
import { resolveLatestForkCheckpoint } from '@main/core/conversations/resolveLatestForkCheckpoint';
import { projectManager } from '@main/core/projects/project-manager';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { createTask } from './createTask';
import { deleteTask } from './deleteTask';

/**
 * Forks in flight, keyed by source checkpoint. A double click must not create
 * two tasks, and the fork mode is deliberately left out of the key so the two
 * modes cannot race on the same checkpoint either.
 */
const pendingForks = new Map<string, Promise<ForkTaskResult>>();

/**
 * Forks a task at one of its session's completed turns into a new task.
 *
 * A task is its session, so a fork is a new task rather than a second session
 * under the source. Both modes reuse existing machinery and add no git logic:
 * `same-branch` checks out the source task's branch, which resolves to the
 * exact same workspace id and only bumps its refcount; `new-branch` branches
 * off it into a worktree of its own.
 */
// Not `async`: an async wrapper would hand each caller a distinct promise, so
// concurrent callers could no longer be told they share one fork.
export function forkTask(params: ForkTaskParams): Promise<ForkTaskResult> {
  const key = forkKey(params);
  const existing = pendingForks.get(key);
  if (existing) return existing;

  const pending = runFork(params).finally(() => {
    if (pendingForks.get(key) === pending) pendingForks.delete(key);
  });
  pendingForks.set(key, pending);
  return pending;
}

async function runFork(params: ForkTaskParams): Promise<ForkTaskResult> {
  const [sourceRow] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, params.taskId), eq(tasks.projectId, params.projectId)))
    .limit(1);
  if (!sourceRow) throw new Error(`Task not found: ${params.taskId}`);
  const sourceTask = mapTaskRowToTask(sourceRow);

  const checkpoint =
    params.checkpoint ??
    (await resolveLatestForkCheckpoint({
      projectId: params.projectId,
      taskId: params.taskId,
      conversationId: params.conversationId,
    }));

  const forkName = `${sourceTask.name} · #${checkpoint.promptIndex + 1}`;
  const { strategy, sourceBranch } = await resolveForkTarget(params, sourceTask);
  const paradigm: ParadigmStamp | undefined =
    sourceTask.paradigmId && sourceTask.paradigmKind
      ? {
          paradigmId: sourceTask.paradigmId,
          paradigmKind: sourceTask.paradigmKind,
          paradigmParams: sourceTask.paradigmParams,
        }
      : undefined;

  const forkTaskId = randomUUID();
  // No `initialConversation`: the session row is inserted by the engine below,
  // once the destination workspace exists and the provider context has been
  // copied into its cwd.
  const created = await createTask({
    id: forkTaskId,
    projectId: params.projectId,
    name: forkName,
    sourceBranch,
    strategy,
    parentTaskId: params.taskId,
    ...(paradigm ? { paradigm } : {}),
  });
  if (!created.success) {
    throw new Error(`Fork failed to create its task: ${JSON.stringify(created.error)}`);
  }
  // A branch-setup failure returns ok() but never provisions, so the engine
  // would have no cwd to write into.
  if (created.data.warning?.type === 'branch-setup-failed') {
    await rollbackForkTask(params.projectId, forkTaskId);
    throw new Error(`Fork failed to set up its branch: ${created.data.warning.message}`);
  }

  try {
    const conversation = await forkSessionIntoTask({
      projectId: params.projectId,
      taskId: params.taskId,
      conversationId: params.conversationId,
      promptIndex: checkpoint.promptIndex,
      target: checkpoint.target,
      initialSize: params.initialSize,
      targetTask: {
        projectId: params.projectId,
        taskId: forkTaskId,
        title: forkName,
      },
    });
    return { task: created.data.task, conversationId: conversation.id };
  } catch (error) {
    await rollbackForkTask(params.projectId, forkTaskId);
    throw error;
  }
}

/**
 * `same-branch` hits the same `localWorkspaceId` key as the source task, so the
 * worktree is shared by refcount instead of cloned. A source task without a
 * branch has no worktree to share or branch off, so its forks stay worktree-less.
 */
async function resolveForkTarget(
  params: ForkTaskParams,
  sourceTask: { name: string; taskBranch?: string; sourceBranch: Branch | undefined }
): Promise<{ strategy: CreateTaskStrategy; sourceBranch: Branch }> {
  if (!sourceTask.taskBranch) {
    return {
      strategy: { kind: 'no-worktree' },
      sourceBranch: sourceTask.sourceBranch ?? (await currentBranchOf(params.projectId)),
    };
  }
  const sourceBranch: Branch = { type: 'local', branch: sourceTask.taskBranch };
  return {
    strategy:
      params.mode === 'same-branch'
        ? { kind: 'checkout-existing' }
        : { kind: 'new-branch', taskBranch: sourceTask.name },
    sourceBranch,
  };
}

async function currentBranchOf(projectId: string): Promise<Branch> {
  const project = projectManager.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const { currentBranch } = await project.repository.getRepositoryInfo();
  if (!currentBranch) throw new Error(`Project has no current branch: ${projectId}`);
  return { type: 'local', branch: currentBranch };
}

/** Best-effort cleanup of the empty task a failed fork left behind. */
async function rollbackForkTask(projectId: string, taskId: string): Promise<void> {
  try {
    await deleteTask(projectId, taskId);
  } catch (error) {
    log.warn('forkTask: failed to roll back the forked task', {
      projectId,
      taskId,
      error: String(error),
    });
  }
}

function forkKey(params: ForkTaskParams): string {
  const checkpointKey = params.checkpoint ? describeCheckpoint(params.checkpoint) : 'latest';
  return `${params.projectId}:${params.taskId}:${params.conversationId}:${checkpointKey}`;
}

function describeCheckpoint(checkpoint: ForkTaskCheckpoint): string {
  const targetId =
    checkpoint.target.kind === 'claude-message'
      ? checkpoint.target.messageId
      : checkpoint.target.turnId;
  return `${checkpoint.promptIndex}:${checkpoint.target.kind}:${targetId}`;
}
