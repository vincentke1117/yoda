import { useCallback } from 'react';
import { getTaskMenuConversation } from '@renderer/features/tasks/components/task-menu-session-info';
import { useProvisionedTaskOrNull } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import type { MarkdownNoteDraft } from '@renderer/lib/ui/markdown-annotations';

/**
 * Formats a markdown note as a single line to stage in a session's input box.
 * No trailing newline — we stage in the prompt line, we don't submit it.
 */
export function formatNoteForInput(note: MarkdownNoteDraft): string {
  return `关于「${note.quote}」：${note.comment} `.replace(/\r?\n/g, ' ');
}

/** Stages a markdown note into the given PTY session's input line. */
export function syncNoteToSessionInput(sessionId: string, note: MarkdownNoteDraft): void {
  void rpc.pty.sendInput(sessionId, formatNoteForInput(note));
}

/**
 * Returns a callback that stages a markdown note into the active session's
 * input box, or `undefined` when there is no task/session to sync into (e.g.
 * the composer settings popover, which renders the same context rows but isn't
 * "opened from a session"). Targets the task's active/most-recent conversation.
 */
export function useSessionNoteSync(): ((note: MarkdownNoteDraft) => void) | undefined {
  const provisioned = useProvisionedTaskOrNull();
  const conversationId = provisioned ? getTaskMenuConversation(provisioned)?.id : undefined;
  const sync = useCallback(
    (note: MarkdownNoteDraft) => {
      if (!provisioned || !conversationId) return;
      const sessionId =
        provisioned.conversations.conversations.get(conversationId)?.session.sessionId;
      if (!sessionId) return;
      syncNoteToSessionInput(sessionId, note);
    },
    [provisioned, conversationId]
  );
  return provisioned ? sync : undefined;
}
