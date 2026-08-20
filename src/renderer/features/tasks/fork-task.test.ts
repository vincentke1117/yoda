import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import type { Task } from '@shared/tasks';
import { canForkSession, forkTaskIntoNewTask, isTaskForkPending, runTaskFork } from './fork-task';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  forkTask: vi.fn(),
  openTaskWhenReady: vi.fn(),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { tasks: { forkTask: mocks.forkTask } } }));
vi.mock('./open-task-when-ready', () => ({ openTaskWhenReady: mocks.openTaskWhenReady }));
vi.mock('@renderer/lib/i18n', () => ({ default: { t: (key: string) => key } }));

function conversation(runtimeId: Conversation['runtimeId']): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    runtimeId,
    title: 'Source',
    lastInteractedAt: '2026-07-17T10:00:00.000Z',
    isInitialConversation: true,
  };
}

const forkedTask = { id: 'task-fork', projectId: 'project-1' } as Task;
const navigate = vi.fn();
const request = {
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'conversation-1',
  mode: 'same-branch',
} as const;

describe('task fork action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.forkTask.mockResolvedValue({ task: forkedTask, conversationId: 'conversation-fork' });
  });

  it('is available only for runtimes with native session-fork support', () => {
    expect(canForkSession(conversation('codex'))).toBe(true);
    expect(canForkSession(conversation('claude'))).toBe(true);
    expect(canForkSession(conversation('gemini'))).toBe(false);
    expect(canForkSession(undefined)).toBe(false);
  });

  it('forks into a new task and routes to its session', async () => {
    await forkTaskIntoNewTask({ ...request, initialSize: { cols: 128, rows: 38 } }, navigate);

    expect(mocks.forkTask).toHaveBeenCalledWith({
      ...request,
      initialSize: { cols: 128, rows: 38 },
    });
    expect(mocks.openTaskWhenReady).toHaveBeenCalledWith('project-1', 'task-fork', navigate, {
      kind: 'conversation',
      conversationId: 'conversation-fork',
    });
  });

  it('reports the fork as pending only while it is in flight', async () => {
    let release: (() => void) | undefined;
    mocks.forkTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ task: forkedTask, conversationId: 'conversation-fork' });
        })
    );

    const pending = forkTaskIntoNewTask(request, navigate);
    expect(isTaskForkPending(request)).toBe(true);
    release?.();
    await pending;
    expect(isTaskForkPending(request)).toBe(false);
  });

  it('surfaces a failed fork as a copyable toast', async () => {
    const error = new Error('fork exploded');
    mocks.forkTask.mockRejectedValue(error);

    runTaskFork(request, navigate);
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalled());

    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'tasks.fork.failed',
      description: 'fork exploded',
      variant: 'destructive',
      debugInfo: error,
    });
  });
});
