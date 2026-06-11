import type { TaskLifecycleStatus } from './tasks';

/** Board columns, in display order. `cancelled` and archived tasks stay off the board. */
export const KANBAN_STATUSES = [
  'todo',
  'in_progress',
  'review',
  'done',
] as const satisfies readonly TaskLifecycleStatus[];

export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

export function isKanbanStatus(status: TaskLifecycleStatus): status is KanbanStatus {
  return (KANBAN_STATUSES as readonly TaskLifecycleStatus[]).includes(status);
}
