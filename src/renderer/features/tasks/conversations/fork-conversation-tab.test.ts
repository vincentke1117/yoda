import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { canForkConversation, forkConversationIntoNewTab } from './fork-conversation-tab';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@renderer/lib/hooks/use-toast', () => ({ toast: mocks.toast }));

function createProvisioned(runtimeId: Conversation['runtimeId'] = 'codex') {
  const source: Conversation = {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    runtimeId,
    title: 'Source',
    lastInteractedAt: '2026-07-17T10:00:00.000Z',
    isInitialConversation: false,
  };
  const forkConversation = vi.fn().mockResolvedValue({ ...source, id: 'conversation-fork' });
  const openConversation = vi.fn();
  const setFocusedRegion = vi.fn();
  const provisioned = {
    conversations: {
      conversations: new Map([
        [
          source.id,
          {
            data: source,
            session: { pty: { lastSentDims: { cols: 128, rows: 38 } } },
          },
        ],
      ]),
      forkConversation,
    },
    taskView: {
      tabManager: { openConversation },
      setFocusedRegion,
    },
  } as unknown as ProvisionedTask;
  return { provisioned, forkConversation, openConversation, setFocusedRegion };
}

describe('conversation tab fork action', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is available only for runtimes with native conversation-fork support', () => {
    expect(canForkConversation(createProvisioned('codex').provisioned, 'conversation-1')).toBe(
      true
    );
    expect(canForkConversation(createProvisioned('claude').provisioned, 'conversation-1')).toBe(
      true
    );
    expect(canForkConversation(createProvisioned('gemini').provisioned, 'conversation-1')).toBe(
      false
    );
  });

  it('creates the fork at the current terminal size and opens it in a new tab', async () => {
    const { provisioned, forkConversation, openConversation, setFocusedRegion } =
      createProvisioned();

    await forkConversationIntoNewTab({
      provisioned,
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      messages: { success: 'Forked', failure: 'Failed' },
    });

    expect(forkConversation).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      initialSize: { cols: 128, rows: 38 },
    });
    expect(openConversation).toHaveBeenCalledWith('conversation-fork');
    expect(setFocusedRegion).toHaveBeenCalledWith('main');
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Forked' });
  });
});
