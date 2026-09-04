import { PerformanceObserver } from 'node:perf_hooks';
import { log } from './logger';

/**
 * How often the probe re-arms itself.
 *
 * The interval does not bound what the probe can see — a 500 ms stall shows up
 * as a 450 ms overshoot on the next fire whatever the interval is. It only sets
 * how finely repeated short stalls are resolved. 50 ms costs 20 timer wakeups a
 * second, which is nothing next to the PTY batches already scheduled at 16 ms.
 */
const SAMPLE_INTERVAL_MS = 50;

/**
 * Overshoot at which a stall is worth naming in the log.
 *
 * Tied to the terminal hot path rather than picked for roundness: a keystroke
 * echo only takes the immediate-flush path while it arrives within
 * PTY_INTERACTIVE_ECHO_WINDOW_MS (100 ms) of the keystroke, and one output batch
 * is scheduled every FLUSH_INTERVAL_MS (16 ms). A stall of 100 ms has therefore
 * already cost the echo its fast path and held six frames of output — it is
 * visible to the user, not a statistical curiosity.
 */
export const MAIN_THREAD_STALL_WARN_MS = 100;

/** How often a summary is emitted, and the window each summary describes. */
const REPORT_INTERVAL_MS = 60_000;

/** Bound the retained window so a long-lived process cannot grow this forever. */
const MAX_RETAINED_SAMPLES = REPORT_INTERVAL_MS / SAMPLE_INTERVAL_MS;

/**
 * Synchronous work worth attributing a stall to.
 *
 * One PTY output batch is scheduled every FLUSH_INTERVAL_MS (16 ms), so a piece
 * of synchronous work that runs longer than that has already delayed terminal
 * output by at least a frame. Track from there — well below the 100 ms stall
 * threshold, so the culprit is recorded before the stall it contributes to.
 */
export const BLOCKING_WORK_TRACK_MS = 16;

/** How many distinct offenders a summary names. */
const TOP_OFFENDERS = 3;

export type BlockingWorkTotal = {
  label: string;
  calls: number;
  totalMs: number;
  maxMs: number;
};

export type MainThreadLagSummary = {
  /** Samples in the reported window. */
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Samples at or above MAIN_THREAD_STALL_WARN_MS. */
  stalls: number;
  /** Total time the loop spent overshooting, i.e. work that displaced timers. */
  totalLagMs: number;
  /** Synchronous work that plausibly caused the stalls, worst total first. */
  topBlocking: BlockingWorkTotal[];
};

function percentile(sortedAscending: number[], fraction: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.ceil(fraction * sortedAscending.length) - 1)
  );
  return sortedAscending[index];
}

export function rankBlockingWork(
  totals: ReadonlyMap<string, BlockingWorkTotal>
): BlockingWorkTotal[] {
  return [...totals.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, TOP_OFFENDERS);
}

export function summarizeLagSamples(
  samples: readonly number[],
  blocking: ReadonlyMap<string, BlockingWorkTotal> = new Map()
): MainThreadLagSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  let stalls = 0;
  let totalLagMs = 0;
  for (const sample of samples) {
    if (sample >= MAIN_THREAD_STALL_WARN_MS) stalls += 1;
    totalLagMs += sample;
  }
  return {
    samples: samples.length,
    p50Ms: Math.round(percentile(sorted, 0.5)),
    p95Ms: Math.round(percentile(sorted, 0.95)),
    p99Ms: Math.round(percentile(sorted, 0.99)),
    maxMs: Math.round(sorted.at(-1) ?? 0),
    stalls,
    totalLagMs: Math.round(totalLagMs),
    topBlocking: rankBlockingWork(blocking),
  };
}

type MainThreadLagProbeOptions = {
  now?: () => number;
  setTimer?: (fn: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onStall?: (lagMs: number) => void;
  onReport?: (summary: MainThreadLagSummary) => void;
};

/**
 * Measure how long the main thread makes its own timers wait.
 *
 * PTY output is read, batched and flushed on this thread alongside synchronous
 * SQLite, git and every RPC handler. Terminal latency is therefore bounded not
 * by how fast the PTY plumbing is — measured at 381 MiB/s for the registry and
 * 50 MiB/s for the checkpoint parser — but by how long that plumbing waits for
 * the thread. This probe is what turns "the terminal feels laggy sometimes"
 * into a number.
 */
export class MainThreadLagProbe {
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly onStall: ((lagMs: number) => void) | undefined;
  private readonly onReport: ((summary: MainThreadLagSummary) => void) | undefined;

  private handle: unknown = null;
  private expectedAt = 0;
  private windowStartedAt = 0;
  private samples: number[] = [];
  private blocking = new Map<string, BlockingWorkTotal>();
  private gcObserver: PerformanceObserver | null = null;

  constructor(options: MainThreadLagProbeOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, delayMs) => setTimeout(fn, delayMs));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never));
    this.onStall = options.onStall;
    this.onReport = options.onReport;
  }

  start(): void {
    if (this.handle !== null) return;
    this.windowStartedAt = this.now();
    this.observeGarbageCollection();
    this.arm();
  }

  /**
   * Attribute a slice of synchronous work, so a stall can name its cause.
   *
   * Anything under BLOCKING_WORK_TRACK_MS is dropped: it cannot have displaced a
   * PTY batch on its own, and keeping every RPC call would make the map the
   * expensive part of the probe.
   */
  recordBlockingWork(label: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < BLOCKING_WORK_TRACK_MS) return;
    const existing = this.blocking.get(label);
    if (existing) {
      existing.calls += 1;
      existing.totalMs = Math.round(existing.totalMs + durationMs);
      existing.maxMs = Math.max(existing.maxMs, Math.round(durationMs));
      return;
    }
    this.blocking.set(label, {
      label,
      calls: 1,
      totalMs: Math.round(durationMs),
      maxMs: Math.round(durationMs),
    });
  }

  /**
   * A long GC pause stops the thread without any handler appearing to run, so
   * without this a major collection looks like an unexplained stall.
   */
  private observeGarbageCollection(): void {
    if (this.gcObserver) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.recordBlockingWork('gc', entry.duration);
        }
      });
      observer.observe({ entryTypes: ['gc'] });
      // Node types do not declare unref on PerformanceObserver, but the handle
      // keeps the loop alive without it.
      (observer as unknown as { unref?: () => void }).unref?.();
      this.gcObserver = observer;
    } catch {
      // GC timing is a diagnostic bonus, never a reason to lose the probe.
    }
  }

  stop(): void {
    this.gcObserver?.disconnect();
    this.gcObserver = null;
    if (this.handle === null) return;
    this.clearTimer(this.handle);
    this.handle = null;
    this.samples = [];
    this.blocking.clear();
  }

  /** Summary of the window so far, without ending it. */
  peek(): MainThreadLagSummary {
    return summarizeLagSamples(this.samples, this.blocking);
  }

  private arm(): void {
    this.expectedAt = this.now() + SAMPLE_INTERVAL_MS;
    this.handle = this.setTimer(() => this.tick(), SAMPLE_INTERVAL_MS);
    (this.handle as { unref?: () => void })?.unref?.();
  }

  private tick(): void {
    const now = this.now();
    // Never negative: a timer may fire late, never early.
    const lagMs = Math.max(0, now - this.expectedAt);
    if (this.samples.length < MAX_RETAINED_SAMPLES) this.samples.push(lagMs);
    if (lagMs >= MAIN_THREAD_STALL_WARN_MS) this.onStall?.(lagMs);
    if (now - this.windowStartedAt >= REPORT_INTERVAL_MS) {
      const summary = summarizeLagSamples(this.samples, this.blocking);
      this.samples = [];
      this.blocking.clear();
      this.windowStartedAt = now;
      if (summary.stalls > 0) this.onReport?.(summary);
    }
    this.arm();
  }
}

let probe: MainThreadLagProbe | null = null;

/**
 * Start the shared probe. Idempotent; safe to call before the app is ready.
 *
 * Only windows that actually contained a stall are reported, so a healthy
 * session stays silent instead of writing a summary a minute forever.
 */
export function startMainThreadLagProbe(): MainThreadLagProbe {
  if (probe) return probe;
  probe = new MainThreadLagProbe({
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

export function getMainThreadLagSummary(): MainThreadLagSummary | null {
  return probe?.peek() ?? null;
}

/** Attribute synchronous work to the running probe, if one was started. */
export function recordMainThreadBlockingWork(label: string, durationMs: number): void {
  probe?.recordBlockingWork(label, durationMs);
}
