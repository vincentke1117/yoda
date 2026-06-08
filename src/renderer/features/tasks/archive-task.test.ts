import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { archiveTaskWithPreCommand } from './archive-task';

const mocks = vi.hoisted(() => ({
  archiveTask: vi.fn(),
  asProvisioned: vi.fn(),
  getConversationsForTask: vi.fn(),
  getTaskManagerStore: vi.fn(),
  getTaskStore: vi.fn(),
  runPreArchiveCommand: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@renderer/features/tasks/run-pre-archive-command', () => ({
  runPreArchiveCommand: mocks.runPreArchiveCommand,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: mocks.asProvisioned,
  getTaskManagerStore: mocks.getTaskManagerStore,
  getTaskStore: mocks.getTaskStore,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    conversations: {
      getConversationsForTask: mocks.getConversationsForTask,
    },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: {
    warn: mocks.warn,
  },
}));

describe('archiveTaskWithPreCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.archiveTask.mockResolvedValue(undefined);
    mocks.getTaskManagerStore.mockReturnValue({ archiveTask: mocks.archiveTask });
    mocks.getTaskStore.mockReturnValue({});
    mocks.runPreArchiveCommand.mockResolvedValue(undefined);
    mocks.getConversationsForTask.mockResolvedValue([]);
  });

  it('runs the pre-archive skill against the active conversation before archiving', async () => {
    mocks.asProvisioned.mockReturnValue(
      makeProvisionedTask({
        activeConversationId: 'conversation-active',
        conversations: [makeConversation('conversation-active')],
      })
    );

    await archiveTaskWithPreCommand('project-1', 'task-1', {
      preArchiveCommand: 'lovstudio-git-commit-with-context',
    });

    expect(mocks.runPreArchiveCommand).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-active',
      'lovstudio-git-commit-with-context'
    );
    expect(mocks.archiveTask).toHaveBeenCalledWith('task-1', undefined);
    expect(mocks.runPreArchiveCommand.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.archiveTask.mock.invocationCallOrder[0]!
    );
  });

  it('uses the most recently interacted stored conversation when no tab is loaded', async () => {
    mocks.asProvisioned.mockReturnValue(makeProvisionedTask({ conversations: [] }));
    mocks.getConversationsForTask.mockResolvedValue([
      makeConversation('conversation-old', '2026-05-01T00:00:00.000Z'),
      makeConversation('conversation-new', '2026-06-01T00:00:00.000Z'),
    ]);

    await archiveTaskWithPreCommand('project-1', 'task-1', {
      preArchiveCommand: 'lovstudio-git-commit-with-context',
    });

    expect(mocks.runPreArchiveCommand).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-new',
      'lovstudio-git-commit-with-context'
    );
  });

  it('skips the pre-archive skill when requested', async () => {
    mocks.asProvisioned.mockReturnValue(
      makeProvisionedTask({
        activeConversationId: 'conversation-active',
        conversations: [makeConversation('conversation-active')],
      })
    );

    await archiveTaskWithPreCommand('project-1', 'task-1', {
      preArchiveCommand: 'lovstudio-git-commit-with-context',
      skipPreCommand: true,
      note: 'done',
    });

    expect(mocks.runPreArchiveCommand).not.toHaveBeenCalled();
    expect(mocks.archiveTask).toHaveBeenCalledWith('task-1', 'done');
  });
});

function makeProvisionedTask(input: {
  activeConversationId?: string;
  conversations: Conversation[];
}) {
  return {
    taskView: {
      tabManager: {
        activeConversationId: input.activeConversationId,
      },
    },
    conversations: {
      conversations: new Map(
        input.conversations.map((conversation) => [
          conversation.id,
          {
            data: conversation,
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
