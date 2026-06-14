import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  buildPromptInjectionPayload,
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitInput,
} from '@shared/agent-command-prefix';
import { makePtySessionId } from '@shared/ptySessionId';
import {
  buildImplementerFeedbackPrompt,
  buildReviewPrompt,
  REVIEW_MAX_ROUNDS,
} from '@shared/review-protocol';
import type { RuntimeId } from '@shared/runtime-registry';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { createConversation } from '@main/core/conversations/createConversation';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { conversations, reviewOrchestrations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { waitForImplementerTurnEnd, waitForReviewResult, type SessionKey } from './turn-signal';

const POLL_MS = 1_500;
/** Watchdog per turn — generous; deterministic signals handle the normal case. */
const TURN_TIMEOUT_MS = 30 * 60_000;
/** If the implementer is never seen running this soon, assume it already ran. */
const IMPLEMENTER_GRACE_MS = 20_000;

type Row = typeof reviewOrchestrations.$inferSelect;

export type StartReviewOrchestrationParams = {
  projectId: string;
  taskId: string;
  implementerConversationId: string;
  requirement: string;
  reviewerRuntime: RuntimeId;
  reviewerSystemPrompt: string;
  reviewerAutoApprove: boolean;
};

class ReviewOrchestrator {
  private active = new Map<string, AbortController>();

  /** Persist a new orchestration and begin driving it. Returns its id. */
  async start(params: StartReviewOrchestrationParams): Promise<string> {
    const id = randomUUID();
    const [row] = await db
      .insert(reviewOrchestrations)
      .values({
        id,
        projectId: params.projectId,
        taskId: params.taskId,
        implementerConversationId: params.implementerConversationId,
        requirement: params.requirement,
        reviewerRuntime: params.reviewerRuntime,
        reviewerSystemPrompt: params.reviewerSystemPrompt,
        reviewerAutoApprove: params.reviewerAutoApprove,
        maxRounds: REVIEW_MAX_ROUNDS,
        round: 1,
        status: 'awaiting_impl',
        createdAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .returning();
    if (row) this.run(row);
    return id;
  }

  /** Resume any orchestration left unfinished by a previous app lifetime. */
  async resumePending(): Promise<void> {
    const pending = await db
      .select()
      .from(reviewOrchestrations)
      .where(
        and(
          isNull(reviewOrchestrations.completedAt),
          inArray(reviewOrchestrations.status, ['awaiting_impl', 'reviewing'])
        )
      );
    if (pending.length === 0) return;
    log.info('ReviewOrchestrator: resuming interrupted orchestrations', { count: pending.length });
    for (const row of pending) this.run(row);
  }

  abort(id: string): void {
    this.active.get(id)?.abort();
  }

  private run(row: Row): void {
    if (this.active.has(row.id)) return;
    const ac = new AbortController();
    this.active.set(row.id, ac);
    void this.loop(row, ac.signal)
      .catch(async (error: unknown) => {
        log.warn('ReviewOrchestrator: orchestration failed', { id: row.id, error: String(error) });
        await this.finish(row.id, 'error', String(error)).catch(() => {});
      })
      .finally(() => {
        this.active.delete(row.id);
      });
  }

  private async loop(row: Row, signal: AbortSignal): Promise<void> {
    const implSession: SessionKey = {
      projectId: row.projectId,
      taskId: row.taskId,
      conversationId: row.implementerConversationId,
    };
    const implSessionId = makePtySessionId(
      row.projectId,
      row.taskId,
      row.implementerConversationId
    );
    const implRuntime = await this.loadRuntime(row.implementerConversationId);

    let round = row.round;
    // Resume in the middle of a review round by skipping straight to a fresh
    // reviewer (the prior reviewer's PTY/buffer is gone after a restart).
    let needImplementerWait = row.status !== 'reviewing';

    while (round <= row.maxRounds) {
      if (signal.aborted) return;

      if (needImplementerWait) {
        const outcome = await waitForImplementerTurnEnd(implSession, {
          signal,
          timeoutMs: TURN_TIMEOUT_MS,
          pollMs: POLL_MS,
          graceMs: IMPLEMENTER_GRACE_MS,
        });
        if (outcome === 'aborted') return;
      }
      needImplementerWait = true;

      const reviewerConversationId = randomUUID();
      await this.update(row.id, {
        status: 'reviewing',
        round,
        currentReviewerConversationId: reviewerConversationId,
      });
      await createConversation({
        id: reviewerConversationId,
        projectId: row.projectId,
        taskId: row.taskId,
        runtime: row.reviewerRuntime as RuntimeId,
        title: `Review · round ${round}`,
        autoApprove: row.reviewerAutoApprove,
        initialPrompt: buildReviewPrompt({
          requirement: row.requirement,
          round,
          systemPrompt: row.reviewerSystemPrompt,
        }),
      });

      const reviewerSession: SessionKey = {
        projectId: row.projectId,
        taskId: row.taskId,
        conversationId: reviewerConversationId,
      };
      const reviewerSessionId = makePtySessionId(row.projectId, row.taskId, reviewerConversationId);
      const review = await waitForReviewResult(reviewerSession, reviewerSessionId, {
        signal,
        timeoutMs: TURN_TIMEOUT_MS,
        pollMs: POLL_MS,
        graceMs: IMPLEMENTER_GRACE_MS,
      });
      if (review.kind === 'aborted') return;
      if (review.result.passed) {
        await this.finish(row.id, 'passed');
        return;
      }

      round += 1;
      if (round > row.maxRounds) {
        await this.finish(row.id, 'failed');
        return;
      }
      await this.update(row.id, {
        status: 'awaiting_impl',
        round,
        currentReviewerConversationId: null,
      });
      await this.sendImplementerFeedback(implSessionId, implSession, implRuntime, {
        requirement: row.requirement,
        reviewFeedback: review.result.feedback,
      });
    }
    await this.finish(row.id, 'failed');
  }

  private async sendImplementerFeedback(
    sessionId: string,
    session: SessionKey,
    runtime: RuntimeId,
    args: { requirement: string; reviewFeedback: string }
  ): Promise<void> {
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty)
      throw new Error('Implementer session is not running; cannot deliver review feedback.');
    const payload = buildPromptInjectionPayload(buildImplementerFeedbackPrompt(args));
    if (!payload) return;
    pty.write(payload);
    // Seed working so the next implementer-turn wait observes a running session.
    agentSessionRuntimeStore.setStatus(session, 'working');
    const submitDelay = getAgentCommandSubmitDelayMs(runtime);
    if (submitDelay > 0) await new Promise((resolve) => setTimeout(resolve, submitDelay));
    pty.write(getAgentCommandSubmitInput(runtime));
  }

  private async loadRuntime(conversationId: string): Promise<RuntimeId> {
    const [row] = await db
      .select({ runtime: conversations.runtime })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    return (row?.runtime as RuntimeId) ?? 'claude';
  }

  private async update(
    id: string,
    fields: Partial<Pick<Row, 'status' | 'round' | 'currentReviewerConversationId'>>
  ): Promise<void> {
    await db.update(reviewOrchestrations).set(fields).where(eq(reviewOrchestrations.id, id));
  }

  private async finish(
    id: string,
    status: 'passed' | 'failed' | 'error',
    error?: string
  ): Promise<void> {
    await db
      .update(reviewOrchestrations)
      .set({ status, error: error ?? null, completedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(reviewOrchestrations.id, id));
  }
}

export const reviewOrchestrator = new ReviewOrchestrator();
