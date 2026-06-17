import { Loader2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LEAKED_PROMPTS_REPO, type LeakedPromptMeta } from '@shared/leaked-prompts';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { useLeakedPrompts, useRefreshLeakedPrompts } from './use-leaked-prompts';

/**
 * Read-only gallery of leaked system prompts from the community
 * github.com/jujumilk3/leaked-system-prompts collection. Browse-and-copy
 * reference material; "save as template" forks an entry into the user's own
 * editable prompts.
 */
export function LeakedPromptsReference() {
  const { t } = useTranslation();
  const { data, isLoading } = useLeakedPrompts();
  const refresh = useRefreshLeakedPrompts();
  const showViewer = useShowModal('leakedPromptViewerModal');
  const [query, setQuery] = useState('');

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) => entry.title.toLowerCase().includes(q) || entry.vendor.toLowerCase().includes(q)
    );
  }, [entries, query]);

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            {t('promptLibrary.reference.title')}
          </h2>
          <p className="mt-1 text-xs text-foreground-muted">
            {t('promptLibrary.reference.description')}{' '}
            <button
              type="button"
              className="text-foreground-muted underline-offset-2 hover:underline"
              onClick={() => void rpc.app.openExternal(`https://github.com/${LEAKED_PROMPTS_REPO}`)}
            >
              {LEAKED_PROMPTS_REPO}
            </button>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {t('promptLibrary.reference.refresh')}
        </Button>
      </div>

      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('promptLibrary.reference.searchPlaceholder')}
        className="mt-4"
      />

      {isLoading ? (
        <div className="mt-6 flex h-24 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-foreground-muted" />
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs text-foreground-passive">
            {t('promptLibrary.reference.count', { count: filtered.length })}
          </p>
          <ul className="mt-2 grid gap-2 @2xl:grid-cols-2">
            {filtered.map((entry) => (
              <ReferenceItem
                key={entry.id}
                entry={entry}
                onOpen={() => showViewer({ meta: entry })}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ReferenceItem({ entry, onOpen }: { entry: LeakedPromptMeta; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background-secondary p-3 text-left transition-colors hover:bg-background-2"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium capitalize text-foreground">
            {entry.title}
          </div>
          <div className="mt-0.5 truncate text-xs text-foreground-muted">{entry.vendor}</div>
        </div>
        {entry.date ? (
          <span className="shrink-0 font-mono text-[11px] text-foreground-passive">
            {entry.date}
          </span>
        ) : null}
      </button>
    </li>
  );
}
