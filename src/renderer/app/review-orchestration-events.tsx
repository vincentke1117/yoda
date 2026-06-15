import { useEffect } from 'react';
import { reviewReviewerStartedChannel } from '@shared/events/reviewEvents';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { events } from '@renderer/lib/ipc';

/**
 * Bridges the main-process review orchestrator's reviewer-start events into the
 * renderer's task view: implementer in the main area, reviewer pinned into the
 * (expanded) sidebar. No-ops when the task isn't currently provisioned — the
 * orchestration keeps running in main regardless.
 */
export function ReviewOrchestrationEvents() {
  useEffect(() => {
    return events.on(reviewReviewerStartedChannel, (payload) => {
      void (async () => {
        const provisioned = asProvisioned(getTaskStore(payload.projectId, payload.taskId));
        if (!provisioned) return;
        // The reviewer conversation was just created in the main process and is
        // not yet in the renderer's store — there is no renderer-side
        // `conversation:created` bridge. Load it (and the implementer) before
        // opening tabs, or the tab resolves to no store and the pane is blank.
        await provisioned.conversations.ensureConversation(payload.implementerConversationId);
        const reviewerLoaded = await provisioned.conversations.ensureConversation(
          payload.reviewerConversationId
        );
        if (!reviewerLoaded) return;
        const { tabManager } = provisioned.taskView;
        tabManager.openConversation(payload.implementerConversationId);
        tabManager.openConversationInSidebar(payload.reviewerConversationId);
        provisioned.taskView.setSidebarCollapsed(false);
      })();
    });
  }, []);

  return null;
}
