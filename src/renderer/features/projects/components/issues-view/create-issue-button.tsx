import { Loader2, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Issue } from '@shared/tasks';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Textarea } from '@renderer/lib/ui/textarea';

interface CreateIssueButtonProps {
  repositoryUrl: string | null;
  disabled?: boolean;
  onCreated?: (issue: Issue) => Promise<void> | void;
}

export function CreateIssueButton({ repositoryUrl, disabled, onCreated }: CreateIssueButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repositoryUrl || isCreating) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError(t('issues.titleRequired'));
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const result = await rpc.github.createIssue({
        repositoryUrl,
        title: trimmedTitle,
        body,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      setTitle('');
      setBody('');
      setOpen(false);
      await onCreated?.(result.issue);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('issues.createIssueFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (isCreating) return;
        setOpen(nextOpen);
        if (!nextOpen) setError(null);
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" disabled={disabled || !repositoryUrl}>
            {isCreating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {t('issues.newIssue')}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-3">
        <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('issues.issueTitlePlaceholder')}
            autoFocus
          />
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('issues.issueBodyPlaceholder')}
            className="min-h-24"
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isCreating}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={isCreating || !title.trim()}>
              {isCreating ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('issues.createIssue')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
