import { Copy, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Prompt, PromptCreateInput } from '@shared/prompt-library';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { useCreatePrompt, useDeletePrompt, usePrompts, useUpdatePrompt } from './use-prompts';

type PromptDraft = {
  title: string;
  description: string;
  content: string;
};

const EMPTY_DRAFT: PromptDraft = { title: '', description: '', content: '' };

function draftFromEntry(entry: Prompt): PromptDraft {
  return { title: entry.title, description: entry.description, content: entry.content };
}

function draftToInput(draft: PromptDraft): PromptCreateInput {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    content: draft.content.trim(),
  };
}

export function PromptLibraryPanel({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showConfirm = useShowModal('confirmActionModal');
  const { data, isLoading } = usePrompts();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const deletePrompt = useDeletePrompt();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_DRAFT);

  const items = useMemo(() => data ?? [], [data]);
  const editorOpen = editingId !== null;
  const canSave = draft.title.trim().length > 0 && draft.content.trim().length > 0;

  const openCreate = () => {
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
  };

  const openEdit = (entry: Prompt) => {
    setEditingId(entry.id);
    setDraft(draftFromEntry(entry));
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    const input = draftToInput(draft);
    const onError = (error: unknown) =>
      toast({
        title: t('promptLibrary.saveFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    if (editingId && editingId !== 'new') {
      updatePrompt.mutate({ id: editingId, patch: input }, { onError });
    } else {
      createPrompt.mutate(input, { onError });
    }
    closeEditor();
  };

  const handleDelete = (entry: Prompt) => {
    showConfirm({
      title: t('promptLibrary.delete.title'),
      description: t('promptLibrary.delete.description', { name: entry.title }),
      confirmLabel: t('promptLibrary.delete.confirmLabel'),
      onSuccess: () => {
        deletePrompt.mutate(entry.id);
        if (editingId === entry.id) closeEditor();
      },
    });
  };

  const handleCopy = (entry: Prompt) => {
    void navigator.clipboard.writeText(entry.content).then(
      () => toast({ title: t('promptLibrary.copied') }),
      () => undefined
    );
  };

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-background text-foreground',
          embedded ? 'h-48' : 'h-full'
        )}
      >
        <Loader2 className="size-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        '@container flex bg-background text-foreground',
        !embedded && 'h-full min-h-0 overflow-y-auto'
      )}
    >
      <div
        className={cn('flex w-full flex-col', !embedded && 'mx-auto max-w-[1060px] px-10 py-12')}
      >
        <div className={cn('flex items-start gap-4', embedded ? 'justify-end' : 'justify-between')}>
          {!embedded && (
            <h1 className="text-4xl font-normal tracking-normal">{t('promptLibrary.title')}</h1>
          )}
          <Button type="button" variant="outline" size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            {t('promptLibrary.new')}
          </Button>
        </div>

        {editorOpen && (
          <form
            onSubmit={handleSave}
            className="mt-10 grid gap-4 rounded-lg border border-border bg-background-secondary p-4"
          >
            <label className="grid gap-1.5">
              <span className="text-xs text-foreground-muted">{t('promptLibrary.form.title')}</span>
              <Input
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, title: event.target.value }))
                }
                placeholder={t('promptLibrary.form.titlePlaceholder')}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs text-foreground-muted">
                {t('promptLibrary.form.description')}
              </span>
              <Input
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
                placeholder={t('promptLibrary.form.descriptionPlaceholder')}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs text-foreground-muted">
                {t('promptLibrary.form.content')}
              </span>
              <Textarea
                value={draft.content}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, content: event.target.value }))
                }
                placeholder={t('promptLibrary.form.contentPlaceholder')}
                className="min-h-40 resize-y font-mono"
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={closeEditor}>
                <X className="size-4" />
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={!canSave}>
                <Save className="size-4" />
                {editingId !== 'new' ? t('common.save') : t('common.create')}
              </Button>
            </div>
          </form>
        )}

        <div className={cn(embedded ? 'mt-8' : 'mt-16')}>
          {items.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('promptLibrary.empty')}</p>
          ) : (
            <ul className="grid gap-3">
              {items.map((entry) => (
                <li
                  key={entry.id}
                  className="group flex items-start gap-3 rounded-lg border border-border bg-background-secondary p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {entry.title}
                    </div>
                    {entry.description && (
                      <div className="mt-0.5 truncate text-xs text-foreground-muted">
                        {entry.description}
                      </div>
                    )}
                    <div className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-xs text-foreground-passive">
                      {entry.content}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('promptLibrary.copy')}
                      onClick={() => handleCopy(entry)}
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('common.edit')}
                      onClick={() => openEdit(entry)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('common.delete')}
                      onClick={() => handleDelete(entry)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
