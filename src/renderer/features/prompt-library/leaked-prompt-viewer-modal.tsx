import { Copy, ExternalLink, Loader2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LeakedPromptMeta } from '@shared/leaked-prompts';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { useLeakedPromptContent } from './use-leaked-prompts';

export type LeakedPromptViewerModalArgs = {
  meta: LeakedPromptMeta;
};

type Props = BaseModalProps<void> & LeakedPromptViewerModalArgs;

export function LeakedPromptViewerModal({ meta, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: content, isLoading, isError } = useLeakedPromptContent(meta.id);
  const { value: principles, update: updatePrinciples } = useAppSettingsKey('promptPrinciples');

  const handleCopy = () => {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(
      () => toast({ title: t('promptLibrary.copied') }),
      () => undefined
    );
  };

  // Adds the prompt as an atomic principle (enabled): the runtime appends
  // enabled principles to every session's system prompt. This is a backend
  // injection, not a copy into the composer.
  const handleAddPrinciple = () => {
    if (!content) return;
    const items = principles?.items ?? [];
    updatePrinciples({
      items: [
        ...items,
        { id: crypto.randomUUID(), name: meta.title, text: content, enabled: true },
      ],
    });
    toast({ title: t('promptLibrary.reference.addedAsPrinciple') });
    onClose();
  };

  return (
    <>
      <DialogHeader className="min-w-0 flex-col items-start gap-1">
        <DialogTitle className="capitalize">{meta.title}</DialogTitle>
        <p className="max-w-full truncate text-xs text-foreground-passive">
          {meta.vendor}
          {meta.date ? ` · ${meta.date}` : ''}
        </p>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-foreground-muted" />
          </div>
        ) : isError || content === null ? (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-foreground-passive">
            {t('promptLibrary.reference.loadFailed')}
          </div>
        ) : (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background-1/40 p-3 text-xs leading-relaxed text-foreground-muted">
            {content}
          </pre>
        )}
      </DialogContentArea>
      <DialogFooter className="justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void rpc.app.openExternal(meta.githubUrl)}
        >
          <ExternalLink className="size-4" />
          {t('promptLibrary.reference.openSource')}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!content}
            onClick={handleCopy}
          >
            <Copy className="size-4" />
            {t('promptLibrary.copy')}
          </Button>
          <Button type="button" size="sm" disabled={!content} onClick={handleAddPrinciple}>
            <Plus className="size-4" />
            {t('promptLibrary.reference.addAsPrinciple')}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
