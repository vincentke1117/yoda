import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { openProvisionedTaskTab } from './open-task-target';

const mocks = vi.hoisted(() => ({
  getArchivedConversationsForTask: vi.fn(),
  showModal: vi.fn(),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: vi.fn(),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: vi.fn(),
  getTaskStore: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    conversations: {
      getArchivedConversationsForTask: mocks.getArchivedConversationsForTask,
    },
  },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  showModal: mocks.showModal,
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    appTabs: {
      closeTab: vi.fn(),
      openTab: vi.fn(),
      stickTab: vi.fn(),
    },
    navigation: {
      currentViewId: 'home',
      viewParamsStore: {},
    },
    sidePane: {
      unpin: vi.fn(),
    },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

const archivedConversation: Conversation = {
  id: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  runtimeId: 'codex',
  title: 'Archived session',
  archivedAt: '2026-06-27T10:04:17.633Z',
  lastInteractedAt: '2026-06-27T09:38:58.604Z',
  isInitialConversation: true,
};

function createProvisionedTask(ensureConversationResult: boolean): ProvisionedTask {
  return {
    projectId: 'project-1',
    taskId: 'task-1',
    conversations: {
      ensureConversation: vi.fn().mockResolvedValue(ensureConversationResult),
    },
    taskView: {
      setFocusedRegion: vi.fn(),
      setSidebarCollapsed: vi.fn(),
      setSidebarTab: vi.fn(),
      tabManager: {
        openConversation: vi.fn(),
        openDiff: vi.fn(),
        openFile: vi.fn(),
        openRoomMember: vi.fn(),
        setActiveTab: vi.fn(),
      },
    },
  } as unknown as ProvisionedTask;
}

describe('openProvisionedTaskTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getArchivedConversationsForTask.mockResolvedValue([]);
  });

  it('opens an active conversation normally', async () => {
    const provisioned = createProvisionedTask(true);

    const opened = await openProvisionedTaskTab(provisioned, {
      kind: 'conversation',
      conversationId: 'conversation-1',
    });

    expect(opened).toBe(true);
    expect(provisioned.conversations.ensureConversation).toHaveBeenCalledWith('conversation-1');
    expect(provisioned.taskView.tabManager.openConversation).toHaveBeenCalledWith('conversation-1');
    expect(mocks.getArchivedConversationsForTask).not.toHaveBeenCalled();
    expect(mocks.showModal).not.toHaveBeenCalled();
  });

  it('opens the archived transcript modal when a deep-linked conversation is archived', async () => {
    const provisioned = createProvisionedTask(false);
    mocks.getArchivedConversationsForTask.mockResolvedValue([archivedConversation]);

    const opened = await openProvisionedTaskTab(provisioned, {
      kind: 'conversation',
      conversationId: 'conversation-1',
    });

    expect(opened).toBe(true);
    expect(mocks.getArchivedConversationsForTask).toHaveBeenCalledWith('project-1', 'task-1');
    expect(provisioned.taskView.tabManager.openConversation).not.toHaveBeenCalled();
    expect(provisioned.taskView.setSidebarCollapsed).toHaveBeenCalledWith(false);
    expect(provisioned.taskView.setSidebarTab).toHaveBeenCalledWith('conversations');
    expect(provisioned.taskView.setFocusedRegion).toHaveBeenCalledWith('main');
    expect(mocks.showModal).toHaveBeenCalledWith('archivedSessionTranscriptModal', {
      conversation: archivedConversation,
    });
  });

  it('returns false when the targeted conversation is neither active nor archived', async () => {
    const provisioned = createProvisionedTask(false);
    mocks.getArchivedConversationsForTask.mockResolvedValue([
      { ...archivedConversation, id: 'other-conversation' },
    ]);

    const opened = await openProvisionedTaskTab(provisioned, {
      kind: 'conversation',
      conversationId: 'conversation-1',
    });

    expect(opened).toBe(false);
    expect(mocks.showModal).not.toHaveBeenCalled();
  });
});
