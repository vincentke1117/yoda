import { RefreshCw, Sparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@renderer/lib/ui/input-group';
import { isImeComposing } from '@renderer/utils/ime';

type RenameConversationModalArgs = {
  projectId: string;
  taskId: string;
  conversationId: string;
  currentTitle: string;
};

type Props = BaseModalProps<void> & RenameConversationModalArgs;

export const RenameConversationModal = observer(function RenameConversationModal({
  projectId,
  taskId,
  conversationId,
  currentTitle,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(currentTitle);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedTitle = title.trim();
  const isValid = normalizedTitle.length > 0 && normalizedTitle !== currentTitle;
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  const isBusy = isSubmitting || isGeneratingTitle;

  const handleSubmit = useCallback(async () => {
    if (!isValid || isBusy) return;
    if (!provisioned) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await provisioned.conversations.renameConversation(conversationId, normalizedTitle);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.sessionInfo.renameFailed'));
      setIsSubmitting(false);
    }
  }, [isValid, isBusy, provisioned, conversationId, normalizedTitle, onSuccess, t]);

  const handleAiSuggest = useCallback(async () => {
    if (!provisioned || isBusy) return;
    setIsGeneratingTitle(true);
    setError(null);
    try {
      const result = await rpc.conversations.generateConversationTitle(
        projectId,
        taskId,
        conversationId,
        provisioned.path
      );
      if (result.snapshot.status === 'skipped') {
        setError(t('tasks.sessionInfo.agentRenameSkipped'));
        return;
      }
      setTitle(result.title.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.rename.aiSuggestionFailed'));
    } finally {
      setIsGeneratingTitle(false);
    }
  }, [conversationId, isBusy, projectId, provisioned, t, taskId]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('tasks.tabs.renameConversation')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <InputGroup>
          <InputGroupInput
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeComposing(e)) {
                void handleSubmit();
              }
            }}
            disabled={isBusy}
            autoFocus
          />
          <InputGroupAddon align="inline-end" className="gap-1 pr-1">
            <InputGroupButton
              type="button"
              variant="ghost"
              onClick={() => void handleAiSuggest()}
              disabled={!provisioned || isBusy}
            >
              {isGeneratingTitle ? (
                <RefreshCw className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              {isGeneratingTitle ? t('tasks.rename.aiSuggesting') : t('tasks.rename.aiSuggest')}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" className="w-full sm:w-auto" onClick={onClose} disabled={isBusy}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton
          className="w-full sm:w-auto"
          onClick={() => void handleSubmit()}
          disabled={!isValid || isBusy}
        >
          {isSubmitting ? t('tasks.rename.renaming') : t('common.rename')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
