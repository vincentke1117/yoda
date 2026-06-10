/** Window event asking every mounted terminal to re-measure + refit. */
export const TERMINAL_RELAYOUT_EVENT = 'terminal-relayout';

/**
 * Ask every mounted terminal to re-measure its host and refit after the next
 * React commit. Needed when a terminal's HOST changes without a size change —
 * e.g. a tab moving between the main area and the sidebar (pin/unpin/reclaim):
 * the ResizeObserver never fires (the container kept its size, only the
 * content moved) and a same-sessionId PtyPane skips its mount measure, so the
 * terminal keeps the previous host's cols.
 */
export function scheduleTerminalRelayout(): void {
  if (typeof window === 'undefined') return;
  // Defer past the React commit that re-hosts the terminal; the listener's own
  // rAF + layout-ready retries absorb any remaining layout settling.
  setTimeout(() => window.dispatchEvent(new Event(TERMINAL_RELAYOUT_EVENT)), 0);
}
