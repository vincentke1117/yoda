import type { TerminalFileLinkTarget } from './terminal-file-links';

export type TerminalLinkTarget =
  | { kind: 'file'; target: TerminalFileLinkTarget }
  | { kind: 'url'; url: string };

export interface TerminalLinkCellPosition {
  x: number;
  y: number;
}

export interface TerminalLinkRange {
  start: TerminalLinkCellPosition;
  end: TerminalLinkCellPosition;
}

export function isTerminalLinkCellInRange(
  range: TerminalLinkRange,
  position: TerminalLinkCellPosition
): boolean {
  if (position.y < range.start.y || position.y > range.end.y) return false;
  if (position.y === range.start.y && position.x < range.start.x) return false;
  if (position.y === range.end.y && position.x > range.end.x) return false;
  return true;
}
