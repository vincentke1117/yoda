import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
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

type Props = BaseModalProps<void>;

export const EditPreArchiveCommandModal = observer(function EditPreArchiveCommandModal({
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { value: homeDraft, update } = useAppSettingsKey('homeDraft');
  const initial = homeDraft?.preArchiveCommand ?? '';
  const [value, setValue] = useState(initial);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (value === initial) {
      onSuccess();
      return;
    }
    setIsSubmitting(true);
    try {
      update({ preArchiveCommand: value });
      onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  }, [value, initial, update, onSuccess]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('tasks.editPreArchiveCommand.title')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('tasks.editPreArchiveCommand.label')}</FieldLabel>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  void handleSubmit();
                }
              }}
              placeholder={t('settings.tasks.preArchiveCommandPlaceholder')}
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('tasks.editPreArchiveCommand.hint')}
            </p>
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={isSubmitting}>
          {t('tasks.editPreArchiveCommand.submit')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
