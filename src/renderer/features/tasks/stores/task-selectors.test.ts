import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/tasks';
import { createUnprovisionedTask } from './task';
import { taskAgentStatus } from './task-selectors';

const mocks = vi.hoisted(() => ({
  isTaskUnread: vi.fn(),
  taskStatus: vi.fn(),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    agentRuntime: {
      isTaskUnread: mocks.isTaskUnread,
      taskStatus: mocks.taskStatus,
    },
  },
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
  },
  rpc: {},
}));

describe('taskAgentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.taskStatus.mockReturnValue(null);
    mocks.isTaskUnread.mockReturnValue(false);
  });

  it('surfaces awaiting-input from global runtime state for unmounted sidebar tasks', () => {
    mocks.taskStatus.mockReturnValue('awaiting-input');

    expect(taskAgentStatus(createUnprovisionedTask(makeTask()))).toBe('awaiting-input');
  });

  it('only surfaces terminal attention states when the task is unread', () => {
    mocks.taskStatus.mockReturnValue('completed');
    mocks.isTaskUnread.mockReturnValue(false);

    expect(taskAgentStatus(createUnprovisionedTask(makeTask()))).toBeNull();

    mocks.isTaskUnread.mockReturnValue(true);

    expect(taskAgentStatus(createUnprovisionedTask(makeTask()))).toBe('completed');
  });
});

function makeTask(): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task',
    status: 'in_progress',
    sourceBranch: undefined,
    createdAt: '2026-06-09T10:00:00.000Z',
    updatedAt: '2026-06-09T10:00:00.000Z',
    statusChangedAt: '2026-06-09T10:00:00.000Z',
    lastInteractedAt: '2026-06-09T10:00:00.000Z',
    isPinned: false,
    needsReview: false,
    isUserNamed: false,
    setupStatus: 'ready',
    prs: [],
    conversations: {},
  };
}
