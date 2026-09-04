import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareExplicitTaskOpen } from './prepare-explicit-task-open';

const mocks = vi.hoisted(() => ({
  ensureProjectLoaded: vi.fn(),
  ensureTaskLoaded: vi.fn(),
  getProjectManagerStore: vi.fn(),
  getTaskManagerStore: vi.fn(),
  mountProject: vi.fn(),
  retryTaskSetup: vi.fn(),
  restoreTask: vi.fn(),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: mocks.getProjectManagerStore,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskManagerStore: mocks.getTaskManagerStore,
}));

describe('prepareExplicitTaskOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureProjectLoaded.mockResolvedValue(true);
    mocks.mountProject.mockResolvedValue(undefined);
    mocks.ensureTaskLoaded.mockResolvedValue(true);
    mocks.retryTaskSetup.mockResolvedValue(undefined);
    mocks.restoreTask.mockResolvedValue(undefined);
    mocks.getProjectManagerStore.mockReturnValue({
      ensureProjectLoaded: mocks.ensureProjectLoaded,
      mountProject: mocks.mountProject,
    });
    mocks.getTaskManagerStore.mockReturnValue({
      ensureTaskLoaded: mocks.ensureTaskLoaded,
      retryTaskSetup: mocks.retryTaskSetup,
      restoreTask: mocks.restoreTask,
      tasks: new Map([
        [
          'task-1',
          {
            state: 'unprovisioned',
            data: { id: 'task-1', archivedAt: '2026-07-05T04:00:00.000Z' },
          },
        ],
      ]),
    });
  });

  it('awaits mount before the point load', async () => {
    await prepareExplicitTaskOpen('project-1', 'task-1');

    expect(mocks.mountProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureTaskLoaded.mock.invocationCallOrder[0]
    );
  });

  it('restores an archived task and its sessions after point-loading it', async () => {
    await prepareExplicitTaskOpen('project-1', 'task-1');

    expect(mocks.mountProject).toHaveBeenCalledWith('project-1');
    expect(mocks.ensureTaskLoaded).toHaveBeenCalledWith('task-1');
    expect(mocks.restoreTask).toHaveBeenCalledWith('task-1');
    expect(mocks.ensureTaskLoaded.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.restoreTask.mock.invocationCallOrder[0]
    );
  });

  it('resumes interrupted setup before an explicit open provisions the task', async () => {
    mocks.getTaskManagerStore.mockReturnValue({
      ensureTaskLoaded: mocks.ensureTaskLoaded,
      retryTaskSetup: mocks.retryTaskSetup,
      restoreTask: mocks.restoreTask,
      tasks: new Map([
        [
          'task-1',
          {
            state: 'unprovisioned',
            data: {
              id: 'task-1',
              archivedAt: '2026-07-05T04:00:00.000Z',
              setupStatus: 'pending',
            },
          },
        ],
      ]),
    });

    await prepareExplicitTaskOpen('project-1', 'task-1');

    expect(mocks.restoreTask).toHaveBeenCalledWith('task-1');
    expect(mocks.retryTaskSetup).toHaveBeenCalledWith('task-1');
    expect(mocks.restoreTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.retryTaskSetup.mock.invocationCallOrder[0]
    );
  });

  it('fails closed when the task cannot be point-loaded', async () => {
    mocks.ensureTaskLoaded.mockResolvedValue(false);

    await expect(prepareExplicitTaskOpen('project-1', 'task-1')).rejects.toThrow(
      'Task task-1 could not be loaded'
    );
    expect(mocks.restoreTask).not.toHaveBeenCalled();
    expect(mocks.retryTaskSetup).not.toHaveBeenCalled();
  });
});
