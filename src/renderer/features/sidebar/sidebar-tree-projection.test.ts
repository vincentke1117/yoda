import { describe, expect, it } from 'vitest';
import {
  getTreeProjection,
  projectedSiblingOrder,
  TREE_DND_INDENT_PX,
  withParents,
} from './sidebar-tree-projection';

// parent(0) > child(1), next(0)
const rows = withParents([
  { taskId: 'parent', depth: 0 },
  { taskId: 'child', depth: 1 },
  { taskId: 'next', depth: 0 },
  { taskId: 'last', depth: 0 },
]);

describe('withParents', () => {
  it('derives parents from the flatten order', () => {
    expect(rows.map((r) => [r.taskId, r.parentTaskId])).toEqual([
      ['parent', null],
      ['child', 'parent'],
      ['next', null],
      ['last', null],
    ]);
  });
});

describe('getTreeProjection', () => {
  it('keeps depth on a pure vertical move', () => {
    const projection = getTreeProjection(rows, 'last', 'next', 0);
    expect(projection).toEqual({ depth: 0, parentTaskId: null });
  });

  it('nests under the row above when dragged one indent to the right', () => {
    // 'last' dropped onto itself but shifted right: previous row is 'next' → parent.
    const projection = getTreeProjection(rows, 'last', 'last', TREE_DND_INDENT_PX);
    expect(projection).toEqual({ depth: 1, parentTaskId: 'next' });
  });

  it('unnests to root when dragged left', () => {
    const childRows = withParents([
      { taskId: 'parent', depth: 0 },
      { taskId: 'child', depth: 1 },
    ]);
    const projection = getTreeProjection(childRows, 'child', 'child', -TREE_DND_INDENT_PX);
    expect(projection).toEqual({ depth: 0, parentTaskId: null });
  });

  it('clamps depth to the row above + 1', () => {
    const projection = getTreeProjection(rows, 'last', 'last', 10 * TREE_DND_INDENT_PX);
    expect(projection).toEqual({ depth: 1, parentTaskId: 'next' });
  });

  it('clamps depth to the next row depth so siblings stay contiguous', () => {
    // Dropping 'last' into the slot above 'child' (depth 1): the next row is
    // 'child' at depth 1, so the dropped row cannot be shallower than 1.
    const projection = getTreeProjection(rows, 'last', 'child', 0);
    expect(projection).toEqual({ depth: 1, parentTaskId: 'parent' });
  });

  it('returns null for unknown rows', () => {
    expect(getTreeProjection(rows, 'missing', 'next', 0)).toBeNull();
  });
});

describe('projectedSiblingOrder', () => {
  it('returns the root order after a root-level move', () => {
    expect(projectedSiblingOrder(rows, 'last', 'next', null)).toEqual(['parent', 'last', 'next']);
  });

  it('returns the child order when nesting into a parent', () => {
    // 'next' takes the slot of 'child' → it lands before 'child' in the group.
    const order = projectedSiblingOrder(rows, 'next', 'child', 'parent');
    expect(order).toEqual(['next', 'child']);
  });
});
