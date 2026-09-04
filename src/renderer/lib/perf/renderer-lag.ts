import { EventLoopLagProbe } from '@shared/event-loop-lag';
import { log } from '@renderer/utils/logger';

let probe: EventLoopLagProbe | null = null;

/**
 * Measure how long the renderer makes its own timers wait.
 *
 * The terminal is painted here, so a stall on this loop delays output exactly
 * as a main-process stall does — and moving PTY delivery off the main process
 * only pays off for the part of the latency that main is actually responsible
 * for. Running the same probe on both sides is what tells those apart.
 *
 * There is no renderer equivalent of the main process's GC observer, so
 * unattributed pauses here stay unattributed.
 */
export function startRendererLagProbe(): EventLoopLagProbe {
  if (probe) return probe;
  probe = new EventLoopLagProbe({
    onStall: (lagMs) => {
      log.warn('[renderer-thread] stalled', { lagMs: Math.round(lagMs) });
    },
    onReport: (summary) => {
      log.warn('[renderer-thread] lag summary', summary);
    },
  });
  probe.start();
  return probe;
}

export function recordRendererBlockingWork(label: string, durationMs: number): void {
  probe?.recordBlockingWork(label, durationMs);
}
