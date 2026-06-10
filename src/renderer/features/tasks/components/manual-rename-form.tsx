import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deriveTaskSlug,
  liveTransformTaskDisplayName,
  MAX_TASK_NAME_LENGTH,
  normalizeTaskDisplayName,
} from '@shared/task-name';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { isImeComposing } from '@renderer/utils/ime';

/**
 * Shared manual-rename form for the task and conversation naming panels. Lives
 * inside the "manual" tab of the naming panel. Both panels persist a normalized
 * display name; the only differences are the conflict set (sibling task names)
 * and whether a branch slug preview is relevant — expressed as props so the UX
 * stays identical.
 */
export function ManualRenameForm({
  currentName,
  onRename,
  getConflicts,
  showBranchPreview = false,
}: {
  currentName: string;
  /** Persist the new (normalized) name. Throw to surface an inline error. */
  onRename: (name: string) => Promise<void>;
  /** Names that would collide (e.g. sibling task names). Empty = no check. */
  getConflicts?: () => Set<string>;
  /** Show the derived git branch slug preview (tasks only). */
  showBranchPreview?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeTaskDisplayName(value);
  const derivedSlug = deriveTaskSlug(normalized);
  const isEmpty = normalized.length === 0;
  const isUnchanged = normalized === currentName;
  const isDuplicate = Boolean(getConflicts?.().has(normalized));
  const slugWouldBeEmpty = !isEmpty && derivedSlug.length === 0;
  const isValid = !isEmpty && !isUnchanged && !isDuplicate && !slugWouldBeEmpty;

  const validationMessage =
    !isUnchanged && isDuplicate
      ? t('tasks.rename.duplicate')
      : isEmpty
        ? t('tasks.rename.empty')
        : slugWouldBeEmpty
          ? t('tasks.rename.invalidSlug')
          : undefined;
  const showValidation = Boolean(validationMessage) && !isUnchanged && value.length > 0;
  const showBranch =
    showBranchPreview &&
    !validationMessage &&
    !isUnchanged &&
    derivedSlug &&
    derivedSlug !== normalized;

  const submit = async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onRename(normalized);
      setValue(normalized);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.rename.renameFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setValue(currentName);
      setError(null);
      event.currentTarget.blur();
      return;
    }
    if (event.key !== 'Enter') return;
    if (isImeComposing(event)) return;
    event.preventDefault();
    void submit();
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Input
          value={value}
          onChange={(event) => {
            setValue(liveTransformTaskDisplayName(event.target.value));
            setError(null);
          }}
          onKeyDown={onKeyDown}
          maxLength={MAX_TASK_NAME_LENGTH}
          aria-invalid={showValidation || Boolean(error)}
          className="h-7 text-xs"
        />
        <Button
          type="button"
          size="xs"
          className="h-7 min-w-20 shrink-0 whitespace-nowrap px-2"
          disabled={!isValid || isSubmitting}
          onClick={() => void submit()}
        >
          {isSubmitting ? t('tasks.rename.renaming') : t('tasks.rename.submit')}
        </Button>
      </div>
      {showValidation ? <p className="text-xs text-destructive">{validationMessage}</p> : null}
      {showBranch ? (
        <p className="truncate text-xs text-muted-foreground">
          {t('tasks.rename.branchPreview', { slug: derivedSlug })}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
