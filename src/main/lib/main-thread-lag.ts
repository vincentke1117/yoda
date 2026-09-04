import { PerformanceObserver } from 'node:perf_hooks';
import {
  EventLoopLagProbe,
  type EventLoopLagSummary,
  type UnattributedPauseObserver,
} from '@shared/event-loop-lag';
import { log } from './logger';

export {
  BLOCKING_WORK_TRACK_MS,
  EVENT_LOOP_STALL_WARN_MS as MAIN_THREAD_STALL_WARN_MS,
} from '@shared/event-loop-lag';
export type { EventLoopLagSummary as MainThreadLagSummary } from '@shared/event-loop-lag';

/**
 * A long GC pause stops the thread without any handler appearing to run, so
 * without this a major collection looks like an unexplained stall.
 */
const observeGarbageCollection: UnattributedPauseObserver = (record) => {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record('gc', entry.duration);
    });
    observer.observe({ entryTypes: ['gc'] });
    // Node types do not declare unref on PerformanceObserver, but the handle
    // keeps the loop alive without it.
    (observer as unknown as { unref?: () => void }).unref?.();
    return () => observer.disconnect();
  } catch {
    // GC timing is a diagnostic bonus, never a reason to lose the probe.
    return () => {};
  }
};

let probe: EventLoopLagProbe | null = null;

/**
 * Start the shared probe. Idempotent; safe to call before the app is ready.
 *
 * Only windows that actually contained a stall are reported, so a healthy
 * session stays silent instead of writing a summary a minute forever.
 */
export function startMainThreadLagProbe(): EventLoopLagProbe {
  if (probe) return probe;
  probe = new EventLoopLagProbe({
    observeUnattributedPauses: observeGarbageCollection,
    onStall: (lagMs) => {
      log.warn('[main-thread] stalled', { lagMs: Math.round(lagMs) });
    },
    onReport: (summary) => {
      log.warn('[main-thread] lag summary', summary);
    },
  });
  probe.start();
  return probe;
}

export function getMainThreadLagSummary(): EventLoopLagSummary | null {
  return probe?.peek() ?? null;
}

/** Attribute synchronous work to the running probe, if one was started. */
export function recordMainThreadBlockingWork(label: string, durationMs: number): void {
  probe?.recordBlockingWork(label, durationMs);
}
