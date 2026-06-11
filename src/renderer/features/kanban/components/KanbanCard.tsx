import { useDraggable } from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import type { Task } from '@shared/tasks';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import type { TaskStore } from '@renderer/features/tasks/stores/task';
import { taskAgentStatus } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';

export type BoardCard = {
  projectId: string;
  projectName: string;
  task: Task;
  taskStore: TaskStore;
};

// The browser can fire a click on the drop target right after a drag —
// without this guard, finishing a drag would also open the task.
let suppressClicksUntil = 0;
export function suppressCardClicks(ms = 300): void {
  suppressClicksUntil = Date.now() + ms;
}

export const KanbanCard = observer(function KanbanCard({ card }: { card: BoardCard }) {
  const { navigate } = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${card.projectId}::${card.task.id}`,
    data: { card },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (Date.now() < suppressClicksUntil) return;
        navigate('task', { projectId: card.projectId, taskId: card.task.id });
      }}
      className={cn('cursor-grab', isDragging && 'opacity-40')}
    >
      <KanbanCardContent card={card} />
    </div>
  );
});

export const KanbanCardContent = observer(function KanbanCardContent({
  card,
  dragging = false,
}: {
  card: BoardCard;
  dragging?: boolean;
}) {
  const status = taskAgentStatus(card.taskStore);

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-md border border-border bg-background p-2.5 transition-colors hover:border-border-focused',
        dragging && 'shadow-lg'
      )}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{card.task.name}</span>
        {status && (
          <span className="shrink-0">
            <AgentStatusIndicator status={status} />
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-foreground-tertiary-passive">
        <span className="truncate">{card.projectName}</span>
        {card.task.taskBranch && (
          <span className="truncate font-mono text-foreground-tertiary-muted">
            {card.task.taskBranch}
          </span>
        )}
      </div>
    </div>
  );
});
