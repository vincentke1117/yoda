import { Copy, ExternalLink, Loader2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LeakedPromptMeta } from '@shared/leaked-prompts';
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
import { useCreatePrompt } from './use-prompts';

export type LeakedPromptViewerModalArgs = {
  meta: LeakedPromptMeta;
};

type Props = BaseModalProps<void> & LeakedPromptViewerModalArgs;

export function LeakedPromptViewerModal({ meta, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: content, isLoading, isError } = useLeakedPromptContent(meta.id);
  const createPrompt = useCreatePrompt();

  const handleCopy = () => {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(
      () => toast({ title: t('promptLibrary.copied') }),
      () => undefined
    );
  };

  const handleSave = () => {
    if (!content) return;
    createPrompt.mutate(
      {
        title: meta.title,
        description: `${meta.vendor}${meta.date ? ` · ${meta.date}` : ''}`,
        content,
      },
      {
        onSuccess: () => {
          toast({ title: t('promptLibrary.reference.saved') });
          onClose();
        },
        onError: (error) =>
          toast({
            title: t('promptLibrary.saveFailed'),
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          }),
      }
    );
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
          <Button type="button" size="sm" disabled={!content} onClick={handleSave}>
            <Save className="size-4" />
            {t('promptLibrary.reference.saveAsTemplate')}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
