import type { Conversation } from '@shared/conversations';
import {
  findClosestCodexThreadTitleByCreatedAt,
  findCodexThreadTitleByTitle,
  getClaimedCodexThreadId,
  readCodexThreadTitle,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';

const SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS = 2 * 60_000;

export function resolveAgentResumeSessionId(conversation: Conversation, cwd?: string): string {
  if (conversation.providerId !== 'codex') return conversation.id;
  return (
    resolveCodexThreadIdForConversation({
      conversationId: conversation.id,
      cwd,
      title: conversation.title,
      createdAt: conversation.createdAt,
    }) ?? conversation.id
  );
}

export function resolveCodexThreadIdForConversation({
  conversationId,
  cwd,
  title,
  createdAt,
  statePath = resolveCodexStatePath(),
}: {
  conversationId: string;
  cwd?: string;
  title?: string;
  createdAt?: string | null;
  statePath?: string;
}): string | undefined {
  const claimedThreadId = getClaimedCodexThreadId(conversationId);
  if (claimedThreadId) return claimedThreadId;

  if (readCodexThreadTitle(statePath, conversationId)) return conversationId;

  const trimmedCwd = cwd?.trim();
  if (!trimmedCwd) return undefined;

  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    const byTitle = findCodexThreadTitleByTitle({
      statePath,
      cwd: trimmedCwd,
      title: trimmedTitle,
    });
    if (byTitle) return byTitle.id;
  }

  const createdAtMs = parseTimestampMs(createdAt);
  if (createdAtMs === undefined) return undefined;

  return findClosestCodexThreadTitleByCreatedAt({
    statePath,
    cwd: trimmedCwd,
    targetCreatedAtMs: createdAtMs,
    maxDistanceMs: CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS,
  })?.id;
}

function parseTimestampMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = SQLITE_TIMESTAMP_RE.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? undefined : ms;
}
