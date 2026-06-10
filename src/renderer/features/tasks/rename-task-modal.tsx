import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deriveTaskSlug,
  liveTransformTaskDisplayName,
  MAX_TASK_NAME_LENGTH,
  normalizeTaskDisplayName,
} from '@shared/task-name';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { isImeComposing } from '@renderer/utils/ime';

type RenameTaskModalArgs = {
  projectId: string;
  taskId: string;
  currentName: string;
};

type Props = BaseModalProps<void> & RenameTaskModalArgs;

export const RenameTaskModal = observer(function RenameTaskModal({
  projectId,
  taskId,
  currentName,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskManager = getTaskManagerStore(projectId);
  const siblingNames = new Set(
    Array.from(taskManager?.tasks.values() ?? [])
      .filter((t) => t.state !== 'unregistered' && t.data.id !== taskId)
      .map((t) => t.data.name)
  );

  const normalizedName = normalizeTaskDisplayName(name);
  const derivedSlug = deriveTaskSlug(normalizedName);
  const isDuplicate = siblingNames.has(normalizedName);
  const isUnchanged = normalizedName === currentName;
  const isEmpty = normalizedName.length === 0;
  const slugWouldBeEmpty = !isEmpty && derivedSlug.length === 0;
  const isValid = !isEmpty && !isDuplicate && !isUnchanged && !slugWouldBeEmpty;

  const validationMessage = isDuplicate
    ? t('tasks.rename.duplicate')
    : isEmpty
      ? t('tasks.rename.empty')
      : slugWouldBeEmpty
        ? t('tasks.rename.invalidSlug')
        : undefined;

  const handleNameChange = useCallback((value: string) => {
    setName(liveTransformTaskDisplayName(value));
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    const task = taskManager?.tasks.get(taskId);
    if (!task) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await task.rename(normalizedName);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.rename.renameFailed'));
      setIsSubmitting(false);
    }
  }, [isValid, taskManager, taskId, normalizedName, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('tasks.rename.title')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('tasks.rename.label')}</FieldLabel>
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isImeComposing(e)) {
                  void handleSubmit();
                }
              }}
              maxLength={MAX_TASK_NAME_LENGTH}
              autoFocus
            />
            {validationMessage && !isUnchanged && (
              <p className="text-xs text-destructive mt-1">{validationMessage}</p>
            )}
            {!validationMessage &&
              !isUnchanged &&
              derivedSlug &&
              derivedSlug !== normalizedName && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t('tasks.rename.branchPreview', { slug: derivedSlug })}
                </p>
              )}
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || isSubmitting}>
          {isSubmitting ? t('tasks.rename.renaming') : t('tasks.rename.submit')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
