import { EventLoopLagProbe, type UnattributedPauseObserver } from '@shared/event-loop-lag';
import { log } from '@renderer/utils/logger';

/**
 * The browser's own report of work that monopolised the loop.
 *
 * `longtask` is the renderer's counterpart to the main process's GC observer:
 * it names a duration for every task over 50ms without the code having to
 * instrument itself. It cannot say which function ran, so explicit
 * `recordRendererBlockingWork` calls stay worthwhile for known-expensive paths.
 */
const observeLongTasks: UnattributedPauseObserver = (record) => {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record('longtask', entry.duration);
    });
    observer.observe({ entryTypes: ['longtask'] });
    return () => observer.disconnect();
  } catch {
    // Not every embedder exposes longtask; the probe is still useful without it.
    return () => {};
  }
};

/**
 * Drop any interval the browser could have throttled instead of run.
 *
 * Chromium throttles timers in a page it is not actively presenting — to once a
 * second, and after five minutes to once a minute. Measuring through that
 * reports a 60s "stall" that is nothing but the throttle, which is exactly the
 * wrong conclusion to hand someone chasing a freeze.
 *
 * `document.visibilityState` alone is not enough: an unfocused or occluded
 * Electron window still reports "visible" while its timers are being throttled.
 * Requiring focus as well narrows measurement to the state that actually
 * matters — the user is looking at this window — at the cost of collecting
 * nothing while the app sits in the background, which is the right trade when
 * the alternative is inventing freezes.
 */
function createMeasurabilityGuard(): () => boolean {
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  document.addEventListener('visibilitychange', interrupt);
  window.addEventListener('blur', interrupt);
  window.addEventListener('focus', interrupt);
  return () => {
    const measurable =
      document.visibilityState === 'visible' && document.hasFocus() && !interrupted;
    interrupted = false;
    return measurable;
  };
}

let probe: EventLoopLagProbe | null = null;

/**
 * Measure how long the renderer makes its own timers wait.
 *
 * The terminal is painted here, so a stall on this loop delays output exactly
 * as a main-process stall does — and moving PTY delivery off the main process
 * only pays off for the part of the latency that main is actually responsible
 * for. Running the same probe on both sides is what tells those apart.
 *
 * Unattributed pauses are covered by the browser's `longtask` entries.
 */
export function startRendererLagProbe(): EventLoopLagProbe {
  if (probe) return probe;
  probe = new EventLoopLagProbe({
    observeUnattributedPauses: observeLongTasks,
    shouldRecordSample: createMeasurabilityGuard(),
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
