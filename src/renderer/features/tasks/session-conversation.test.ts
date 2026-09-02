import { describe, expect, it } from 'vitest';
import type { ClaudeSessionPrompt, SessionTranscriptMessage } from '@shared/conversations';
import {
  buildSessionConversationPreviewTurns,
  buildSessionTurns,
  filterTurnReplies,
  type SessionTurn,
} from './session-conversation';

const prompts: ClaudeSessionPrompt[] = [
  {
    id: 'user-1',
    text: 'Build the feature',
    timestamp: null,
    restoreTarget: { kind: 'codex-turn', turnId: 'turn-1' },
  },
  { id: 'user-2', text: 'Polish it', timestamp: null },
];

const messages: SessionTranscriptMessage[] = [
  { id: 'user-1', role: 'user', text: 'Build the feature', timestamp: null },
  {
    id: 'assistant-1',
    role: 'assistant',
    text: 'I will inspect the code.',
    timestamp: null,
    phase: 'commentary',
  },
  {
    id: 'assistant-2',
    role: 'assistant',
    text: 'Implemented and tested.',
    timestamp: null,
    phase: 'final',
  },
  { id: 'user-2', role: 'user', text: 'Polish it', timestamp: null },
];

function flatten(turns: SessionTurn[]): { role: 'user' | 'assistant'; text: string }[] {
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const turn of turns) {
    if (turn.user) out.push({ role: 'user', text: turn.user.message.text });
    for (const reply of turn.replies) out.push({ role: 'assistant', text: reply.text });
  }
  return out;
}

describe('buildSessionTurns', () => {
  it('keeps user-only mode prompt-backed for restore actions', () => {
    const turns = buildSessionTurns(prompts, []);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.user?.prompt?.restoreTarget).toEqual({
      kind: 'codex-turn',
      turnId: 'turn-1',
    });
    expect(turns[0]?.user?.promptIndex).toBe(1);
    expect(turns[0]?.replies).toEqual([]);
  });

  it('groups every user prompt with its agent replies into one turn', () => {
    const turns = buildSessionTurns(prompts, messages);

    expect(flatten(turns)).toEqual([
      { role: 'user', text: 'Build the feature' },
      { role: 'assistant', text: 'I will inspect the code.' },
      { role: 'assistant', text: 'Implemented and tested.' },
      { role: 'user', text: 'Polish it' },
    ]);
  });

  it('preserves restore actions when runtime prompt and message ids differ', () => {
    const turns = buildSessionTurns(prompts, [
      { id: 'event-user-1', role: 'user', text: 'Build the feature', timestamp: null },
    ]);

    expect(turns[0]?.user?.promptIndex).toBe(1);
    expect(turns[0]?.user?.prompt?.restoreTarget).toEqual({
      kind: 'codex-turn',
      turnId: 'turn-1',
    });
  });

  it('keeps original transcript positions for prompt subsets', () => {
    const turns = buildSessionTurns([prompts[0]!], [], [5]);

    expect(turns[0]?.user?.promptIndex).toBe(5);
  });

  it('deduplicates consecutive final replies by their user-visible text', () => {
    const duplicatedFinal = 'Implemented and tested.';
    const turns = buildSessionTurns(prompts, [
      messages[0]!,
      {
        id: 'assistant-response-item',
        role: 'assistant',
        text: `${duplicatedFinal}

<oai-mem-citation>
internal metadata
</oai-mem-citation>`,
        timestamp: '2026-07-30T08:09:37.052Z',
        phase: 'final',
      },
      {
        id: 'assistant-task-complete',
        role: 'assistant',
        text: duplicatedFinal,
        timestamp: '2026-07-30T08:09:37.053Z',
        phase: 'final',
      },
      messages[3]!,
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.replies.map((reply) => reply.text)).toEqual([duplicatedFinal]);
    expect(flatten(turns)).toEqual([
      { role: 'user', text: 'Build the feature' },
      { role: 'assistant', text: duplicatedFinal },
      { role: 'user', text: 'Polish it' },
    ]);
  });

  it('keeps identical final replies when a user turn separates them', () => {
    const repeatedFinal = 'Done.';
    const turns = buildSessionTurns(prompts, [
      messages[0]!,
      {
        id: 'assistant-1',
        role: 'assistant',
        text: repeatedFinal,
        timestamp: null,
        phase: 'final',
      },
      messages[3]!,
      {
        id: 'assistant-2',
        role: 'assistant',
        text: repeatedFinal,
        timestamp: null,
        phase: 'final',
      },
    ]);

    expect(flatten(turns).filter((item) => item.role === 'assistant')).toHaveLength(2);
  });
});

describe('filterTurnReplies', () => {
  const replies = buildSessionTurns(prompts, messages)[0]!.replies;

  it('hides every reply in hidden mode', () => {
    expect(filterTurnReplies(replies, 'hidden')).toEqual([]);
  });

  it('keeps only the closing reply in concise mode', () => {
    expect(filterTurnReplies(replies, 'concise').map((reply) => reply.text)).toEqual([
      'Implemented and tested.',
    ]);
  });

  it('adds the commentary in detailed mode', () => {
    expect(filterTurnReplies(replies, 'detailed').map((reply) => reply.text)).toEqual([
      'I will inspect the code.',
      'Implemented and tested.',
    ]);
  });
});

describe('buildSessionConversationPreviewTurns', () => {
  it('keeps the beginning and end while reporting the hidden middle', () => {
    const turns = Array.from({ length: 8 }, (_, index) => ({
      key: String(index),
      user: {
        message: { id: String(index), role: 'user' as const, text: String(index), timestamp: null },
      },
      replies: [],
    }));

    expect(
      buildSessionConversationPreviewTurns(turns).map((item) =>
        item.type === 'truncated' ? `hidden:${item.hiddenCount}` : item.item.user?.message.text
      )
    ).toEqual(['0', '1', '2', 'hidden:2', '5', '6', '7']);
  });
});
