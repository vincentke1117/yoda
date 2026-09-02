import type { Conversation } from '@shared/conversations';
import { supportsRuntimeConversationFork } from '@shared/runtime-registry';
import type { ForkTaskCheckpoint, ForkTaskMode, ForkTaskResult } from '@shared/tasks';
import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
import { rpc } from '@renderer/lib/ipc';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { openTaskWhenReady } from './open-task-when-ready';

export type ForkTaskRequest = {
  projectId: string;
  taskId: string;
  conversationId: string;
  mode: ForkTaskMode;
  /** Omitted forks at the session's latest completed turn. */
  checkpoint?: ForkTaskCheckpoint;
  initialSize?: { cols: number; rows: number };
};

/**
 * Forks in flight, keyed by source checkpoint so a double click cannot produce
 * two tasks. The main process dedupes authoritatively; this only lets surfaces
 * show the pending state and gate their own triggers.
 */
const pendingForks = new Set<string>();

/** Whether the session's runtime can fork its provider-native context. */
export function canForkSession(conversation: Conversation | undefined): boolean {
  return conversation ? supportsRuntimeConversationFork(conversation.runtimeId) : false;
}

export function isTaskForkPending(
  request: Pick<ForkTaskRequest, 'projectId' | 'taskId' | 'conversationId' | 'checkpoint'>
): boolean {
  return pendingForks.has(forkKey(request));
}

/**
 * Forks a task at one of its session's turns into a new task and routes to it.
 *
 * A task is its session, so the fork lands as a sibling task rather than a
 * second session under the source. Throws so callers can own their messaging.
 */
export async function forkTaskIntoNewTask(
  request: ForkTaskRequest,
  navigate: NavigateFnTyped
): Promise<ForkTaskResult> {
  const key = forkKey(request);
  pendingForks.add(key);
  try {
    const result = await rpc.tasks.forkTask(request);
    await openTaskWhenReady(result.task.projectId, result.task.id, navigate, {
      kind: 'conversation',
      conversationId: result.conversationId,
    });
    return result;
  } finally {
    pendingForks.delete(key);
  }
}

/** Fire-and-forget fork with the shared success/failure toast. */
export function runTaskFork(request: ForkTaskRequest, navigate: NavigateFnTyped): void {
  if (isTaskForkPending(request)) return;
  void forkTaskIntoNewTask(request, navigate)
    .then(() => {
      toast({ title: i18n.t('tasks.fork.success') });
    })
    .catch((error: unknown) => {
      toast({
        title: i18n.t('tasks.fork.failed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
        debugInfo: error,
      });
    });
}

/** Excludes the mode: the two modes must not race on the same checkpoint. */
function forkKey(
  request: Pick<ForkTaskRequest, 'projectId' | 'taskId' | 'conversationId' | 'checkpoint'>
): string {
  const checkpoint = request.checkpoint;
  const checkpointKey = checkpoint
    ? `${checkpoint.promptIndex}:${checkpoint.target.kind}:${
        checkpoint.target.kind === 'claude-message'
          ? checkpoint.target.messageId
          : checkpoint.target.turnId
      }`
    : 'latest';
  return `${request.projectId}:${request.taskId}:${request.conversationId}:${checkpointKey}`;
}
