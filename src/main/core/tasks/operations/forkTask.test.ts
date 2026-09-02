import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/tasks';
import { forkTask } from './forkTask';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  forkSessionIntoTask: vi.fn(),
  getProject: vi.fn(),
  mapTaskRowToTask: vi.fn(),
  resolveLatestForkCheckpoint: vi.fn(),
  selectChain: {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: { select: vi.fn(() => mocks.selectChain) },
}));
vi.mock('./createTask', () => ({ createTask: mocks.createTask }));
vi.mock('./deleteTask', () => ({ deleteTask: mocks.deleteTask }));
vi.mock('@main/core/conversations/forkSessionIntoTask', () => ({
  forkSessionIntoTask: mocks.forkSessionIntoTask,
}));
vi.mock('@main/core/conversations/resolveLatestForkCheckpoint', () => ({
  resolveLatestForkCheckpoint: mocks.resolveLatestForkCheckpoint,
}));
vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));
vi.mock('@main/core/tasks/utils/utils', () => ({
  mapTaskRowToTask: mocks.mapTaskRowToTask,
}));

const sourceTask = {
  id: 'task-1',
  projectId: 'project-1',
  name: 'Ship the fork',
  taskBranch: 'mark/ship-the-fork-a1b2c',
  sourceBranch: { type: 'local', branch: 'main' },
  paradigmId: 'paradigm-1',
  paradigmKind: 'solo',
  paradigmParams: { runtimeId: 'codex' },
} as unknown as Task;

const forkedTask = { id: 'task-fork', projectId: 'project-1' } as Task;

const params = {
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'conversation-1',
  mode: 'same-branch' as const,
  checkpoint: { promptIndex: 2, target: { kind: 'codex-turn' as const, turnId: 'turn-3' } },
};

function createdTaskId(): string {
  return (mocks.createTask.mock.calls[0]?.[0] as { id: string }).id;
}

describe('forkTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectChain.from.mockReturnThis();
    mocks.selectChain.where.mockReturnThis();
    mocks.selectChain.limit.mockResolvedValue([{ id: 'task-1' }]);
    mocks.mapTaskRowToTask.mockReturnValue(sourceTask);
    mocks.createTask.mockResolvedValue({ success: true, data: { task: forkedTask } });
    mocks.forkSessionIntoTask.mockResolvedValue({ id: 'conversation-fork' });
    mocks.deleteTask.mockResolvedValue(undefined);
  });

  it('shares the source worktree in same-branch mode and inherits its paradigm', async () => {
    await expect(forkTask(params)).resolves.toEqual({
      task: forkedTask,
      conversationId: 'conversation-fork',
    });

    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        name: 'Ship the fork · #3',
        // Checking out the source task's own branch resolves to the same
        // workspace id, so the worktree is refcounted instead of cloned.
        strategy: { kind: 'checkout-existing' },
        sourceBranch: { type: 'local', branch: 'mark/ship-the-fork-a1b2c' },
        parentTaskId: 'task-1',
        paradigm: {
          paradigmId: 'paradigm-1',
          paradigmKind: 'solo',
          paradigmParams: { runtimeId: 'codex' },
        },
      })
    );
    // The session row belongs to the engine, once the destination cwd exists.
    expect(mocks.createTask.mock.calls[0]?.[0]).not.toHaveProperty('initialConversation');
    expect(mocks.forkSessionIntoTask).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      promptIndex: 2,
      target: { kind: 'codex-turn', turnId: 'turn-3' },
      initialSize: undefined,
      targetTask: {
        projectId: 'project-1',
        taskId: createdTaskId(),
        title: 'Ship the fork · #3',
      },
    });
  });

  it('branches off the source branch into its own worktree in new-branch mode', async () => {
    await forkTask({ ...params, mode: 'new-branch' });

    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: { kind: 'new-branch', taskBranch: 'Ship the fork' },
        sourceBranch: { type: 'local', branch: 'mark/ship-the-fork-a1b2c' },
      })
    );
  });

  it('stays worktree-less when the source task has no branch', async () => {
    mocks.mapTaskRowToTask.mockReturnValue({
      ...sourceTask,
      taskBranch: undefined,
    } as unknown as Task);

    await forkTask({ ...params, mode: 'new-branch' });

    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: { kind: 'no-worktree' },
        sourceBranch: { type: 'local', branch: 'main' },
      })
    );
  });

  it('forks at the session latest completed turn when no checkpoint is given', async () => {
    mocks.resolveLatestForkCheckpoint.mockResolvedValue({
      promptIndex: 0,
      target: { kind: 'claude-message', messageId: 'answer-1' },
    });

    await forkTask({ ...params, checkpoint: undefined });

    expect(mocks.resolveLatestForkCheckpoint).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
    });
    expect(mocks.forkSessionIntoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        promptIndex: 0,
        target: { kind: 'claude-message', messageId: 'answer-1' },
      })
    );
  });

  it('deduplicates concurrent forks of the same checkpoint across both modes', async () => {
    let release: ((conversation: { id: string }) => void) | undefined;
    mocks.forkSessionIntoTask.mockReturnValueOnce(
      new Promise<{ id: string }>((resolve) => {
        release = resolve;
      })
    );

    const first = forkTask(params);
    const second = forkTask({ ...params, mode: 'new-branch' });

    expect(first).toBe(second);
    await vi.waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    release?.({ id: 'conversation-fork' });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('forks separate checkpoints independently even when their target ids match', async () => {
    const target = { kind: 'codex-turn' as const, turnId: 'turn-3' };

    const first = forkTask({ ...params, checkpoint: { promptIndex: 1, target } });
    const second = forkTask({ ...params, checkpoint: { promptIndex: 2, target } });

    expect(first).not.toBe(second);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.createTask).toHaveBeenCalledTimes(2);
  });

  it('rolls back the empty task when its branch setup failed', async () => {
    mocks.createTask.mockResolvedValue({
      success: true,
      data: {
        task: forkedTask,
        warning: {
          type: 'branch-setup-failed',
          branch: 'mark/fork',
          message: 'worktree add failed',
        },
      },
    });

    await expect(forkTask(params)).rejects.toThrow('worktree add failed');

    expect(mocks.forkSessionIntoTask).not.toHaveBeenCalled();
    expect(mocks.deleteTask).toHaveBeenCalledWith('project-1', createdTaskId());
  });

  it('rolls back the new task when copying the session context fails', async () => {
    mocks.forkSessionIntoTask.mockRejectedValue(new Error('transcript missing'));

    await expect(forkTask(params)).rejects.toThrow('transcript missing');

    expect(mocks.deleteTask).toHaveBeenCalledWith('project-1', createdTaskId());
  });

  it('rejects a fork of a task that no longer exists', async () => {
    mocks.selectChain.limit.mockResolvedValue([]);

    await expect(forkTask(params)).rejects.toThrow('Task not found: task-1');
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
