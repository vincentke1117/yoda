import type { AgentReplyDisplayLevel } from '@lovstudio/yoda-protocol/agent-reply-display';
import type { ClaudeSessionPrompt, SessionTranscriptMessage } from '@shared/conversations';

/** One turn's user side: the transcript message plus its matched prompt. */
export type SessionTurnUser = {
  message: SessionTranscriptMessage;
  prompt?: ClaudeSessionPrompt;
  promptIndex?: number;
};

/**
 * A question-and-answer unit: one user prompt and every agent reply that
 * follows it. All content is kept here regardless of the display level — the
 * level only decides how much of `replies` is shown by default, so a card can
 * be expanded one step at a time without re-fetching.
 */
export type SessionTurn = {
  key: string;
  user?: SessionTurnUser;
  /** Agent replies in transcript order. `commentary` before `final`. */
  replies: SessionTranscriptMessage[];
};

/** Reply display levels that render as conversation cards (not the raw feed). */
export type ReplyDisplayLevel = Exclude<AgentReplyDisplayLevel, 'verbose'>;

export type SessionConversationPreviewItem =
  | {
      type: 'message';
      item: SessionTurn;
    }
  | {
      type: 'truncated';
      hiddenCount: number;
    };

/**
 * Builds the full Q&A turns for a session. Level-independent: the caller keeps
 * every reply and collapses per card, so a user can expand one turn locally
 * even when the default level hides replies. User-only mode stays prompt-backed
 * so restore checkpoints remain available when the runtime has no transcript.
 */
export function buildSessionTurns(
  prompts: ClaudeSessionPrompt[],
  messages: SessionTranscriptMessage[],
  promptNumbers?: number[]
): SessionTurn[] {
  if (messages.length === 0) {
    return prompts.map((prompt, index) => ({
      key: `user:${prompt.id}:${index}`,
      user: {
        message: {
          id: prompt.id,
          role: 'user',
          text: prompt.text,
          timestamp: prompt.timestamp,
        },
        prompt,
        promptIndex: promptNumbers?.[index] ?? index + 1,
      },
      replies: [],
    }));
  }

  const usedPromptIndexes = new Set<number>();
  const turns: SessionTurn[] = [];
  let current: SessionTurn | undefined;

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      if (!message.text) return;
      const match = findMatchingPrompt(prompts, usedPromptIndexes, message);
      const turn: SessionTurn = {
        key: `user:${message.id}:${index}`,
        user: {
          message,
          ...(match
            ? {
                prompt: match.prompt,
                promptIndex: promptNumbers?.[match.index] ?? match.index + 1,
              }
            : {}),
        },
        replies: [],
      };
      turns.push(turn);
      current = turn;
      return;
    }

    const visibleText = getUserVisibleAgentReplyText(message.text);
    if (!visibleText) return;

    let turn = current;
    if (!turn) {
      turn = { key: `assistant:${message.id}:${index}`, replies: [] };
      turns.push(turn);
      current = turn;
    }

    const replies = turn.replies;
    const previous = replies[replies.length - 1];
    if (previous?.phase === 'final' && message.phase === 'final' && previous.text === visibleText) {
      replies[replies.length - 1] = { ...message, text: visibleText };
      return;
    }
    replies.push({ ...message, text: visibleText });
  });
  return turns;
}

/**
 * The reply messages a given level shows. `concise` keeps only the turn's
 * closing reply; `detailed` adds the pre-tool-call commentary.
 */
export function filterTurnReplies(
  replies: SessionTranscriptMessage[],
  level: ReplyDisplayLevel
): SessionTranscriptMessage[] {
  if (level === 'hidden') return [];
  if (level === 'concise') return replies.filter((reply) => reply.phase === 'final');
  return replies;
}

export function getUserVisibleAgentReplyText(text: string): string {
  return text.replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, '').trim();
}

function findMatchingPrompt(
  prompts: ClaudeSessionPrompt[],
  usedPromptIndexes: Set<number>,
  message: SessionTranscriptMessage
): { prompt: ClaudeSessionPrompt; index: number } | undefined {
  let promptIndex = prompts.findIndex(
    (prompt, index) => !usedPromptIndexes.has(index) && prompt.id === message.id
  );
  if (promptIndex < 0) {
    promptIndex = prompts.findIndex(
      (prompt, index) => !usedPromptIndexes.has(index) && prompt.text === message.text
    );
  }
  const prompt = prompts[promptIndex];
  if (!prompt) return undefined;
  usedPromptIndexes.add(promptIndex);
  return { prompt, index: promptIndex };
}

export function buildSessionConversationPreviewTurns(
  turns: SessionTurn[],
  headCount = 3,
  tailCount = headCount
): SessionConversationPreviewItem[] {
  const safeHeadCount = Math.max(0, headCount);
  const safeTailCount = Math.max(0, tailCount);
  const visibleLimit = safeHeadCount + safeTailCount;
  if (turns.length <= visibleLimit) {
    return turns.map((turn) => ({ type: 'message' as const, item: turn }));
  }

  return [
    ...turns.slice(0, safeHeadCount).map((turn) => ({ type: 'message' as const, item: turn })),
    {
      type: 'truncated',
      hiddenCount: turns.length - visibleLimit,
    },
    ...turns.slice(turns.length - safeTailCount).map((turn) => ({
      type: 'message' as const,
      item: turn,
    })),
  ];
}
