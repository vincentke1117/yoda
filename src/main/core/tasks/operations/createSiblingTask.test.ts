import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/tasks';
import { createSiblingTask } from './createSiblingTask';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  getProject: vi.fn(),
  mapTaskRowToTask: vi.fn(),
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

const siblingTask = { id: 'task-review', projectId: 'project-1' } as Task;

const params = {
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Acceptance review',
  runtime: 'claude' as const,
  initialPrompt: 'Review the work on this branch.',
};

describe('createSiblingTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectChain.from.mockReturnThis();
    mocks.selectChain.where.mockReturnThis();
    mocks.selectChain.limit.mockResolvedValue([{ id: 'task-1' }]);
    mocks.mapTaskRowToTask.mockReturnValue(sourceTask);
    mocks.createTask.mockResolvedValue({ success: true, data: { task: siblingTask } });
  });

  it('runs the second agent as a subtask sharing the source branch and worktree', async () => {
    await expect(createSiblingTask(params)).resolves.toEqual({
      task: siblingTask,
      conversationId: expect.any(String),
    });

    const created = mocks.createTask.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(created).toEqual(
      expect.objectContaining({
        projectId: 'project-1',
        name: 'Acceptance review',
        // Checking out the source task's own branch resolves to the same
        // workspace id, so the worktree is refcounted instead of cloned.
        strategy: { kind: 'checkout-existing' },
        sourceBranch: { type: 'local', branch: 'mark/ship-the-fork-a1b2c' },
        parentTaskId: 'task-1',
        // The caller named this on purpose; auto-naming must not rewrite it.
        nameIsExplicit: true,
        paradigm: {
          paradigmId: 'paradigm-1',
          paradigmKind: 'solo',
          paradigmParams: { runtimeId: 'codex' },
        },
      })
    );
    // A task is its session, so the session is created with the task.
    expect(created.initialConversation).toEqual(
      expect.objectContaining({
        projectId: 'project-1',
        taskId: created.id,
        runtime: 'claude',
        title: 'Acceptance review',
        initialPrompt: 'Review the work on this branch.',
      })
    );
  });

  it('stays worktree-less when the source task has no branch to share', async () => {
    mocks.mapTaskRowToTask.mockReturnValue({
      ...sourceTask,
      taskBranch: undefined,
    } as unknown as Task);

    await createSiblingTask(params);

    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: { kind: 'no-worktree' },
        sourceBranch: { type: 'local', branch: 'main' },
      })
    );
  });

  it('surfaces a failed creation instead of returning a task that never provisioned', async () => {
    mocks.createTask.mockResolvedValue({
      success: false,
      error: { type: 'worktree-setup-failed', branch: 'mark/ship-the-fork-a1b2c' },
    });

    await expect(createSiblingTask(params)).rejects.toThrow(/worktree-setup-failed/);
  });

  it('rejects when the source task is not in the given project', async () => {
    mocks.selectChain.limit.mockResolvedValue([]);

    await expect(createSiblingTask(params)).rejects.toThrow('Task not found: task-1');
  });
});
