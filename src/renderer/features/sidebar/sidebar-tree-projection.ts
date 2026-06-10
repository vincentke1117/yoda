import { arrayMove } from '@dnd-kit/sortable';

/**
 * Pure helpers for the sidebar subtask-tree drag projection (dnd-kit tree
 * example style): the pointer's horizontal offset picks the target depth, the
 * vertical sort position picks the siblings, and both combine into the
 * projected parent.
 */

export type TreeFlatRow = {
  taskId: string;
  depth: number;
  parentTaskId: string | null;
};

export type TreeProjection = {
  depth: number;
  parentTaskId: string | null;
};

/** Indent width must match the per-level indent used by SidebarTaskItem. */
export const TREE_DND_INDENT_PX = 14;

/**
 * Annotate depth-only rows with their parent, derived from the flatten order
 * (a row's parent is the nearest preceding row one level shallower).
 */
export function withParents(rows: { taskId: string; depth: number }[]): TreeFlatRow[] {
  const stack: TreeFlatRow[] = []; // current ancestor chain, one entry per depth
  const result: TreeFlatRow[] = [];
  for (const row of rows) {
    stack.length = Math.min(stack.length, row.depth);
    const parent = row.depth > 0 ? (stack[row.depth - 1] ?? null) : null;
    const flat: TreeFlatRow = { ...row, parentTaskId: parent?.taskId ?? null };
    result.push(flat);
    stack[row.depth] = flat;
  }
  return result;
}

/**
 * Project the drop target while dragging `activeTaskId` over `overTaskId`.
 * `rows` must already exclude the active task's descendants (they travel with
 * it), which also makes a projected cycle impossible.
 */
export function getTreeProjection(
  rows: TreeFlatRow[],
  activeTaskId: string,
  overTaskId: string,
  offsetX: number,
  indentWidth: number = TREE_DND_INDENT_PX
): TreeProjection | null {
  const activeIndex = rows.findIndex((row) => row.taskId === activeTaskId);
  const overIndex = rows.findIndex((row) => row.taskId === overTaskId);
  if (activeIndex === -1 || overIndex === -1) return null;

  const activeRow = rows[activeIndex];
  const newRows = arrayMove(rows, activeIndex, overIndex);
  const previousRow: TreeFlatRow | undefined = newRows[overIndex - 1];
  const nextRow: TreeFlatRow | undefined = newRows[overIndex + 1];

  const projectedDepth = activeRow.depth + Math.round(offsetX / indentWidth);
  const maxDepth = previousRow ? previousRow.depth + 1 : 0;
  const minDepth = nextRow ? nextRow.depth : 0;
  const depth = Math.min(Math.max(projectedDepth, minDepth), maxDepth);

  return { depth, parentTaskId: getParentId(newRows, overIndex, depth, previousRow) };
}

function getParentId(
  newRows: TreeFlatRow[],
  overIndex: number,
  depth: number,
  previousRow: TreeFlatRow | undefined
): string | null {
  if (depth === 0 || !previousRow) return null;
  if (depth === previousRow.depth) return previousRow.parentTaskId;
  if (depth > previousRow.depth) return previousRow.taskId;
  for (let i = overIndex - 1; i >= 0; i--) {
    if (newRows[i].depth === depth) return newRows[i].parentTaskId;
  }
  return null;
}

/**
 * Sibling task ids under `parentTaskId` after dropping the active row at
 * `overIndex` with the projected parent — the new manual order for that group.
 */
export function projectedSiblingOrder(
  rows: TreeFlatRow[],
  activeTaskId: string,
  overTaskId: string,
  parentTaskId: string | null
): string[] {
  const activeIndex = rows.findIndex((row) => row.taskId === activeTaskId);
  const overIndex = rows.findIndex((row) => row.taskId === overTaskId);
  if (activeIndex === -1 || overIndex === -1) return [];
  const newRows = arrayMove(rows, activeIndex, overIndex);
  return newRows
    .filter((row) => row.taskId === activeTaskId || row.parentTaskId === parentTaskId)
    .map((row) => row.taskId);
}
