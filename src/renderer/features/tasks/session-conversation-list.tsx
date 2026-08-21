import { ChevronDown, ChevronUp, Loader2, MoreHorizontal } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ClaudeSessionPrompt,
  SessionCompaction,
  SessionTranscriptMessage,
} from '@shared/conversations';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { SessionCompactionMarker } from '@renderer/features/tasks/conversations/session-compaction-marker';
import { SessionPromptRestoreButton } from '@renderer/features/tasks/conversations/session-prompt-restore-button';
import {
  compactionsBeforePrompt,
  trailingCompactions,
} from '@renderer/features/tasks/session-compactions';
import {
  buildSessionConversationPreviewTurns,
  buildSessionTurns,
  filterTurnReplies,
  type ReplyDisplayLevel,
  type SessionTurn,
  type SessionTurnUser,
} from '@renderer/features/tasks/session-conversation';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { cn } from '@renderer/utils/utils';

export function SessionConversationList({
  prompts,
  messages,
  displayLevel,
  variant,
  promptNumbers,
  compactions,
  isLoading = false,
  onOpenAll,
  onRestorePrompt,
  restoringPromptId,
}: {
  prompts: ClaudeSessionPrompt[];
  messages: SessionTranscriptMessage[];
  displayLevel: ReplyDisplayLevel;
  variant: 'preview' | 'full';
  /** Optional one-based transcript positions when displaying a prompt subset. */
  promptNumbers?: number[];
  /**
   * Only meaningful when `prompts` is a whole session — the boundaries are
   * positioned against that array, so a `promptNumbers` subset must omit them.
   */
  compactions?: SessionCompaction[];
  isLoading?: boolean;
  onOpenAll?: () => void;
  onRestorePrompt?: (prompt: ClaudeSessionPrompt, index: number) => void;
  restoringPromptId?: string | null;
}) {
  const { t } = useTranslation();
  const turns = useMemo(
    () => buildSessionTurns(prompts, messages, promptNumbers),
    [messages, promptNumbers, prompts]
  );
  const visibleItems = useMemo(
    () =>
      variant === 'preview'
        ? buildSessionConversationPreviewTurns(turns)
        : turns.map((turn) => ({ type: 'message' as const, item: turn })),
    [turns, variant]
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-1 py-1.5 text-xs text-foreground-passive">
        <Loader2 className="size-3 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  if (turns.length === 0) {
    return (
      <div className="px-1 py-1.5 text-xs text-foreground-passive">
        {t('tasks.panel.noPrompts')}
      </div>
    );
  }

  return (
    <div className={cn('grid', variant === 'preview' ? 'gap-1' : 'gap-2')}>
      {visibleItems.map((entry) =>
        entry.type === 'truncated' ? (
          <button
            key="truncated"
            type="button"
            className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-[11px] text-foreground-passive hover:bg-background-1 hover:text-foreground-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onOpenAll}
          >
            <MoreHorizontal className="size-3.5" />
            {t('tasks.sessionInfo.truncatedMessages', { count: entry.hiddenCount })}
          </button>
        ) : (
          <Fragment key={entry.item.key}>
            <SessionCompactionMarker
              compactions={
                entry.item.user?.promptIndex
                  ? compactionsBeforePrompt(compactions, entry.item.user.promptIndex)
                  : []
              }
              placement="flow"
            />
            <SessionTurnRow
              turn={entry.item}
              variant={variant}
              displayLevel={displayLevel}
              onRestorePrompt={onRestorePrompt}
              isRestoring={restoringPromptId === entry.item.user?.prompt?.id}
            />
          </Fragment>
        )
      )}
      <SessionCompactionMarker
        compactions={trailingCompactions(compactions, prompts.length)}
        placement="flow"
      />
    </div>
  );
}

/**
 * One Q&A card: the user prompt on top and the agent's replies below, unified
 * into a single visual unit. `displayLevel` is only the default collapse depth —
 * the reply zone steps up one level at a time (hidden → concise → detailed)
 * locally, so a reply hidden by the global mode can still be read per card.
 */
function SessionTurnRow({
  turn,
  variant,
  displayLevel,
  onRestorePrompt,
  isRestoring,
}: {
  turn: SessionTurn;
  variant: 'preview' | 'full';
  displayLevel: ReplyDisplayLevel;
  onRestorePrompt?: (prompt: ClaudeSessionPrompt, index: number) => void;
  isRestoring: boolean;
}) {
  const [overrideLevel, setOverrideLevel] = useState<ReplyDisplayLevel>();
  const effectiveLevel = overrideLevel ?? displayLevel;
  const visibleReplies = useMemo(
    () => filterTurnReplies(turn.replies, effectiveLevel),
    [effectiveLevel, turn.replies]
  );
  // An explicit per-card interaction takes over from the preview's height cap:
  // the default keeps the docked strip compact, expanding shows the full text.
  const manual = overrideLevel !== undefined;

  return (
    <article
      className={cn(
        'group min-w-0 rounded-sm bg-background-1/45',
        variant === 'full' && 'border border-border'
      )}
    >
      {turn.user ? (
        <TurnUserZone
          user={turn.user}
          variant={variant}
          onRestorePrompt={onRestorePrompt}
          isRestoring={isRestoring}
        />
      ) : null}
      {turn.replies.length > 0 ? (
        <section
          className={cn(
            'min-w-0 border-l-2 border-primary/45 bg-primary/5',
            variant === 'preview' ? 'px-2 py-1.5' : 'rounded-r-sm p-2.5',
            turn.user ? 'mt-1' : null
          )}
        >
          <div
            className={cn(
              'grid gap-2',
              variant === 'preview' && !manual && 'max-h-48 overflow-hidden'
            )}
          >
            {visibleReplies.map((reply) => (
              <AgentReplyBlock key={reply.id} reply={reply} variant={variant} />
            ))}
          </div>
          <ReplyAffordance
            effectiveLevel={effectiveLevel}
            count={turn.replies.length}
            onStep={() => setOverrideLevel(stepLevel(effectiveLevel))}
          />
        </section>
      ) : null}
    </article>
  );
}

function TurnUserZone({
  user,
  variant,
  onRestorePrompt,
  isRestoring,
}: {
  user: SessionTurnUser;
  variant: 'preview' | 'full';
  onRestorePrompt?: (prompt: ClaudeSessionPrompt, index: number) => void;
  isRestoring: boolean;
}) {
  const { t } = useTranslation();
  const text = displaySessionPromptText(user.message.text);
  const timestamp = formatTimestamp(user.message.timestamp);
  const canRestore = Boolean(
    user.prompt && user.promptIndex && user.prompt.restoreTarget && onRestorePrompt
  );

  return (
    <header
      className={cn('flex flex-col gap-1', variant === 'preview' ? 'px-1.5 py-1' : 'px-2.5 py-2')}
    >
      <div className="flex min-w-0 items-center gap-2 text-[10px] text-foreground-passive">
        <span className="font-mono">
          {user.promptIndex
            ? t('tasks.sessionInfo.userMessageIndex', { index: user.promptIndex })
            : t('tasks.sessionInfo.userMessage')}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {timestamp ? <span className="font-mono">{timestamp}</span> : null}
          {canRestore && user.prompt && user.promptIndex && onRestorePrompt ? (
            <SessionPromptRestoreButton
              prompt={user.prompt}
              index={user.promptIndex}
              isRestoring={isRestoring}
              onRestore={onRestorePrompt}
              className={
                variant === 'preview'
                  ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                  : undefined
              }
            />
          ) : null}
        </span>
      </div>
      <p
        className={cn(
          'whitespace-pre-wrap break-words text-foreground-muted',
          variant === 'preview'
            ? 'max-h-32 overflow-hidden text-[11px] leading-snug'
            : 'text-xs leading-relaxed'
        )}
      >
        {text}
      </p>
    </header>
  );
}

function AgentReplyBlock({
  reply,
  variant,
}: {
  reply: SessionTranscriptMessage;
  variant: 'preview' | 'full';
}) {
  const { t } = useTranslation();
  const timestamp = formatTimestamp(reply.timestamp);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-foreground-passive">
        <span className="font-medium text-foreground-muted">{t('tasks.sessionInfo.agent')}</span>
        {reply.phase === 'final' ? (
          <span className="rounded-full bg-primary/10 px-1.5 py-px text-[9px] text-primary">
            {t('tasks.sessionInfo.finalResult')}
          </span>
        ) : null}
        {timestamp ? <span className="ml-auto shrink-0 font-mono">{timestamp}</span> : null}
      </div>
      <MarkdownRenderer
        content={reply.text}
        variant="compact"
        annotations={false}
        className={cn(
          'mt-1 min-w-0 break-words text-foreground-muted [&>*:last-child]:mb-0 [&_pre]:max-w-full',
          variant === 'preview' ? 'text-[11px] leading-snug' : 'text-xs leading-relaxed'
        )}
      />
    </div>
  );
}

/**
 * The per-card expand/collapse control. Steps through the reply depths one at
 * a time: hidden → concise → detailed → hidden, so a globally hidden reply can
 * be read locally without changing the mode.
 */
function ReplyAffordance({
  effectiveLevel,
  count,
  onStep,
}: {
  effectiveLevel: ReplyDisplayLevel;
  count: number;
  onStep: () => void;
}) {
  const { t } = useTranslation();
  const label =
    effectiveLevel === 'hidden'
      ? `${t('tasks.sessionInfo.replyCount', { count })} · ${t('tasks.sessionInfo.expandReply')}`
      : effectiveLevel === 'concise'
        ? t('tasks.sessionInfo.expandAllReplies')
        : t('tasks.sessionInfo.collapseReplies');
  const Chevron = effectiveLevel === 'detailed' ? ChevronUp : ChevronDown;

  return (
    <button
      type="button"
      className="mt-1 flex w-full items-center justify-center gap-1 rounded-sm py-0.5 text-[11px] text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
      onClick={onStep}
    >
      <Chevron className="size-3" />
      {label}
    </button>
  );
}

function stepLevel(level: ReplyDisplayLevel): ReplyDisplayLevel {
  return level === 'hidden' ? 'concise' : level === 'concise' ? 'detailed' : 'hidden';
}

function formatTimestamp(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime()) ? null : value.toLocaleTimeString();
}
