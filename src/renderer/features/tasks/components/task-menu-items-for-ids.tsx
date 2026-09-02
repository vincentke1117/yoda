import { observer } from 'mobx-react-lite';
import { TaskContextMenuItems } from '@renderer/features/tasks/components/task-context-menu';
import { useTaskMenuActions } from '@renderer/features/tasks/components/use-task-menu-actions';

/**
 * The shared task menu items for a surface that only holds the ids (a pinned
 * chip, a side-pane entry) and therefore cannot call the hook itself. Renders
 * nothing when the task store is gone.
 */
export const TaskMenuItemsForIds = observer(function TaskMenuItemsForIds({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const actions = useTaskMenuActions(projectId, taskId);
  if (!actions) return null;
  return <TaskContextMenuItems {...actions} />;
});
