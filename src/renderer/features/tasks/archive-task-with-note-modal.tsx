import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useArchiveTask } from '@renderer/features/tasks/archive-task';
import { toast } from '@renderer/lib/hooks/use-toast';
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

type ArchiveTaskWithNoteModalArgs = {
  projectId: string;
  taskId: string;
  taskName: string;
};

type Props = BaseModalProps<void> & ArchiveTaskWithNoteModalArgs;

const MAX_ARCHIVE_NOTE_LENGTH = 280;

export const ArchiveTaskWithNoteModal = observer(function ArchiveTaskWithNoteModal({
  projectId,
  taskId,
  taskName,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');

  const { archiveTask } = useArchiveTask(projectId);

  const handleSubmit = useCallback(() => {
    // The archive flow can run for minutes (pre-archive commands against every
    // live conversation), so it continues in the background — progress shows as
    // loading states on the task row and conversation tabs, not in this dialog.
    void archiveTask(taskId, { note }).catch((e: unknown) => {
      toast({
        title: t('sidebar.archiveTask'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    });
    onSuccess();
  }, [archiveTask, taskId, note, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('tasks.archiveWithNote.title', { name: taskName })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('tasks.archiveWithNote.label')}</FieldLabel>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  handleSubmit();
                }
              }}
              placeholder={t('tasks.archiveWithNote.placeholder')}
              maxLength={MAX_ARCHIVE_NOTE_LENGTH}
              autoFocus
            />
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton onClick={handleSubmit}>{t('tasks.archiveWithNote.submit')}</ConfirmButton>
      </DialogFooter>
    </>
  );
});
