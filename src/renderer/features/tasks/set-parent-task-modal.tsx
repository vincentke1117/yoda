import { Check, ListTree, Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SetTaskParentError } from '@shared/tasks';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  getTaskManagerStore,
  isTaskDescendantOf,
} from '@renderer/features/tasks/stores/task-selectors';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';

type SetParentTaskModalArgs = {
  projectId: string;
  taskId: string;
};

type Props = BaseModalProps<void> & SetParentTaskModalArgs;

/**
 * Parent-task picker: same-project active tasks, excluding the task itself and
 * its descendants (re-parenting into the own subtree would create a cycle —
 * the main process re-validates anyway).
 */
export const SetParentTaskModal = observer(function SetParentTaskModal({
  projectId,
  taskId,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskManager = getTaskManagerStore(projectId);
  const task = taskManager?.tasks.get(taskId);
  const currentParentId = task ? (registeredTaskData(task)?.parentTaskId ?? null) : null;
  const [selectedParentId, setSelectedParentId] = useState<string | null>(currentParentId);

  const candidates = useMemo(() => {
    const result: TaskStore[] = [];
    for (const store of taskManager?.tasks.values() ?? []) {
      const data = registeredTaskData(store);
      if (!data || data.id === taskId || data.archivedAt) continue;
      if (isTaskDescendantOf(projectId, data.id, taskId)) continue;
      result.push(store);
    }
    return result;
  }, [taskManager, projectId, taskId]);

  const filtered = query.trim()
    ? candidates.filter((store) =>
        store.data.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : candidates;

  const handleSubmit = useCallback(async () => {
    if (!task || selectedParentId === currentParentId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await task.setParentTask(selectedParentId);
      if (result && !result.success) {
        setError(setParentErrorMessage(result.error, t));
        setIsSubmitting(false);
        return;
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.setParent.failed'));
      setIsSubmitting(false);
    }
  }, [task, selectedParentId, currentParentId, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle className="flex items-center gap-2">
          <ListTree className="size-4" />
          {t('tasks.setParent.title')}
        </DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-2 pt-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('tasks.setParent.searchPlaceholder')}
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-y-auto rounded-md border border-border">
          <ParentOptionRow
            label={t('tasks.setParent.noParent')}
            isSelected={selectedParentId === null}
            onSelect={() => setSelectedParentId(null)}
            muted
          />
          {filtered.map((store) => (
            <ParentOptionRow
              key={store.data.id}
              label={store.data.name}
              isSelected={selectedParentId === store.data.id}
              onSelect={() => setSelectedParentId(store.data.id)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {t('tasks.setParent.noResults')}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || selectedParentId === currentParentId}
        >
          {t('common.save')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});

function ParentOptionRow({
  label,
  isSelected,
  onSelect,
  muted,
}: {
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-background-tertiary-1',
        isSelected && 'bg-background-tertiary-1',
        muted && 'text-muted-foreground'
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      {isSelected && <Check className="size-3.5 shrink-0" />}
    </button>
  );
}

function setParentErrorMessage(
  error: SetTaskParentError,
  t: ReturnType<typeof useTranslation>['t']
): string {
  switch (error.type) {
    case 'cycle-detected':
      return t('tasks.setParent.cycleDetected');
    case 'cross-project':
      return t('tasks.setParent.crossProject');
    case 'parent-archived':
      return t('tasks.setParent.parentArchived');
    default:
      return t('tasks.setParent.failed');
  }
}
