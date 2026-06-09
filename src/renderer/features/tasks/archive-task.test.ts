import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { archiveTaskWithPreCommand } from './archive-task';

const mocks = vi.hoisted(() => ({
  archiveTask: vi.fn(),
  setTaskArchiving: vi.fn(),
  asProvisioned: vi.fn(),
  getTaskManagerStore: vi.fn(),
  getTaskStore: vi.fn(),
  runPreArchiveCommand: vi.fn(),
  archiveConversation: vi.fn(),
  load: vi.fn(),
}));

vi.mock('@renderer/features/tasks/run-pre-archive-command', () => ({
  runPreArchiveCommand: mocks.runPreArchiveCommand,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: mocks.asProvisioned,
  getTaskManagerStore: mocks.getTaskManagerStore,
  getTaskStore: mocks.getTaskStore,
}));

// archive-task.ts pulls in the settings hook, which imports the ipc module —
// that touches `window` at module load, so stub it out for node.
vi.mock('@renderer/lib/ipc', () => ({
  rpc: {},
  events: { on: vi.fn() },
}));

describe('archiveTaskWithPreCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.archiveTask.mockResolvedValue(undefined);
    mocks.getTaskManagerStore.mockReturnValue({
      archiveTask: mocks.archiveTask,
      setTaskArchiving: mocks.setTaskArchiving,
    });
    mocks.getTaskStore.mockReturnValue({});
    mocks.runPreArchiveCommand.mockResolvedValue(undefined);
    mocks.archiveConversation.mockResolvedValue(undefined);
    mocks.load.mockResolvedValue(undefined);
  });

  it('runs the pre-archive skill against every conversation and archives them before the task', async () => {
    mocks.asProvisioned.mockReturnValue(
      makeProvisionedTask([makeConversation('conversation-a'), makeConversation('conversation-b')])
    );

    await archiveTaskWithPreCommand('project-1', 'task-1', {
      preArchiveCommand: 'lovstudio-git-commit-with-context',
    });

    expect(mocks.runPreArchiveCommand.mock.calls.map((call) => call[2]).sort()).toEqual([
      'conversation-a',
      'conversation-b',
    ]);
    expect(mocks.archiveConversation.mock.calls.map((call) => call[0]).sort()).toEqual([
      'conversation-a',
      'conversation-b',
    ]);
    expect(mocks.archiveTask).toHaveBeenCalledWith('task-1', undefined);
    // Every conversation archive must land before the task archive.
    for (const order of mocks.archiveConversation.mock.invocationCallOrder) {
      expect(order).toBeLessThan(mocks.archiveTask.mock.invocationCallOrder[0]!);
    }
  });

  it('skips the pre-archive skill when requested but still archives conversations first', async () => {
    mocks.asProvisioned.mockReturnValue(makeProvisionedTask([makeConversation('conversation-a')]));

    await archiveTaskWithPreCommand('project-1', 'task-1', {
      preArchiveCommand: 'lovstudio-git-commit-with-context',
      skipPreCommand: true,
      note: 'done',
    });

    expect(mocks.runPreArchiveCommand).not.toHaveBeenCalled();
    expect(mocks.archiveConversation).toHaveBeenCalledWith('conversation-a');
    expect(mocks.archiveTask).toHaveBeenCalledWith('task-1', 'done');
  });

  it('does not archive the task when a conversation archive fails', async () => {
    mocks.asProvisioned.mockReturnValue(makeProvisionedTask([makeConversation('conversation-a')]));
    mocks.archiveConversation.mockRejectedValue(new Error('archive failed'));

    await expect(
      archiveTaskWithPreCommand('project-1', 'task-1', {
        preArchiveCommand: 'lovstudio-git-commit-with-context',
      })
    ).rejects.toThrow('archive failed');

    expect(mocks.archiveTask).not.toHaveBeenCalled();
    // The loading flag must be cleared even on failure.
    expect(mocks.setTaskArchiving).toHaveBeenLastCalledWith('task-1', false);
  });

  it('archives the task directly when it has no provisioned store', async () => {
    mocks.asProvisioned.mockReturnValue(undefined);

    await archiveTaskWithPreCommand('project-1', 'task-1', {
      preArchiveCommand: 'lovstudio-git-commit-with-context',
    });

    expect(mocks.runPreArchiveCommand).not.toHaveBeenCalled();
    expect(mocks.archiveTask).toHaveBeenCalledWith('task-1', undefined);
  });
});

function makeProvisionedTask(conversations: Conversation[]) {
  return {
    conversations: {
      load: mocks.load,
      archiveConversation: mocks.archiveConversation,
      conversations: new Map(
        conversations.map((conversation) => [
          conversation.id,
          {
            data: conversation,
            setArchiving: vi.fn(),
          },
        ])
      ),
    },
  };
}

function makeConversation(id: string, lastInteractedAt = '2026-06-01T00:00:00.000Z'): Conversation {
  return {
    id,
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: id,
    lastInteractedAt,
    isInitialConversation: false,
  };
}
