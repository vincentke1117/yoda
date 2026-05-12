import { when } from 'mobx';
import type {
  ConversationManagerStore,
  ConversationStore,
} from '@renderer/features/tasks/conversations/conversation-manager';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { buildPromptInjectionPayload } from '@renderer/lib/pty/prompt-injection';
import { log } from '@renderer/utils/logger';

const COMPLETION_TIMEOUT_MS = 10 * 60_000;

/**
 * If `command` is non-empty, send it to the task's most-recently-used
 * conversation and resolve only after the agent has finished (status flips
 * away from `working`). No-op when command is empty / there is no live
 * conversation. Errors are swallowed-and-logged so archiving can proceed even
 * if the pre-archive step fails.
 */
export async function runPreArchiveCommand(
  projectId: string,
  taskId: string,
  command: string
): Promise<void> {
  const trimmed = command.trim();
  if (!trimmed) return;

  const task = getTaskStore(projectId, taskId);
  const provisioned = asProvisioned(task);
  if (!provisioned) return;

  const target = pickTargetConversation(provisioned.conversations);
  if (!target) return;

  const payload = buildPromptInjectionPayload({
    providerId: target.data.providerId,
    text: trimmed,
  });
  if (!payload) return;

  try {
    target.setWorking();
    await rpc.pty.sendInput(target.session.sessionId, payload);
    // Slash commands and prompts both need a submit keystroke. \r matches
    // the convention used by the terminal input buffer.
    await rpc.pty.sendInput(target.session.sessionId, '\r');
    await when(() => target.status !== 'working', { timeout: COMPLETION_TIMEOUT_MS });
  } catch (error) {
    log.warn('runPreArchiveCommand failed', { projectId, taskId, error: String(error) });
  }
}

function pickTargetConversation(manager: ConversationManagerStore): ConversationStore | undefined {
  let bestStore: ConversationStore | undefined;
  let bestLast = -Infinity;
  for (const store of manager.conversations.values()) {
    const last = store.data.lastInteractedAt ? Date.parse(store.data.lastInteractedAt) : 0;
    if (last > bestLast) {
      bestLast = last;
      bestStore = store;
    }
  }
  return bestStore;
}
