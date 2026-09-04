import { describe, expect, it, vi } from 'vitest';
import {
  MAIN_THREAD_STALL_WARN_MS,
  MainThreadLagProbe,
  summarizeLagSamples,
} from './main-thread-lag';

vi.mock('./logger', () => ({ log: { warn: vi.fn(), debug: vi.fn() } }));

/** Drive the probe on a clock the test moves by hand. */
function createHarness() {
  let now = 0;
  let pending: (() => void) | null = null;
  const stalls: number[] = [];
  const reports: ReturnType<typeof summarizeLagSamples>[] = [];
  const probe = new MainThreadLagProbe({
    now: () => now,
    setTimer: (fn) => {
      pending = fn;
      return 1;
    },
    clearTimer: () => {
      pending = null;
    },
    onStall: (lagMs) => stalls.push(lagMs),
    onReport: (summary) => reports.push(summary),
  });
  return {
    probe,
    stalls,
    reports,
    /** Advance the clock by `elapsedMs` and let the armed timer fire. */
    tick(elapsedMs: number) {
      now += elapsedMs;
      const fire = pending;
      pending = null;
      fire?.();
    },
  };
}

describe('summarizeLagSamples', () => {
  it('reports percentiles, stall count and displaced time', () => {
    const samples = [0, 1, 2, 3, 4, 5, 6, 7, 8, 400];
    const summary = summarizeLagSamples(samples);

    expect(summary.samples).toBe(10);
    expect(summary.p50Ms).toBe(4);
    expect(summary.maxMs).toBe(400);
    expect(summary.stalls).toBe(1);
    expect(summary.totalLagMs).toBe(436);
  });

  it('is defined for an empty window', () => {
    expect(summarizeLagSamples([])).toEqual({
      samples: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      stalls: 0,
      totalLagMs: 0,
    });
  });
});

describe('MainThreadLagProbe', () => {
  it('measures overshoot rather than elapsed time', () => {
    const harness = createHarness();
    harness.probe.start();

    // Fires exactly on its 50 ms deadline: no lag.
    harness.tick(50);
    expect(harness.probe.peek().maxMs).toBe(0);

    // Fires 250 ms late: the thread was busy for 200 ms beyond the interval.
    harness.tick(250);
    expect(harness.probe.peek().maxMs).toBe(200);
    expect(harness.stalls).toEqual([200]);
  });

  it('does not report a stall below the warning threshold', () => {
    const harness = createHarness();
    harness.probe.start();

    harness.tick(50 + MAIN_THREAD_STALL_WARN_MS - 1);

    expect(harness.probe.peek().maxMs).toBe(MAIN_THREAD_STALL_WARN_MS - 1);
    expect(harness.stalls).toEqual([]);
  });

  it('summarizes a window only when it contained a stall', () => {
    const harness = createHarness();
    harness.probe.start();

    // A quiet minute: every sample lands on time, so nothing is reported.
    for (let i = 0; i < 1_200; i += 1) harness.tick(50);
    expect(harness.reports).toEqual([]);

    // One stall inside the next window makes that window worth reporting.
    harness.tick(50 + 300);
    for (let i = 0; i < 1_200; i += 1) harness.tick(50);
    expect(harness.reports).toHaveLength(1);
    expect(harness.reports[0]?.stalls).toBe(1);
    expect(harness.reports[0]?.maxMs).toBe(300);
  });

  it('keeps re-arming after a stall and stops cleanly', () => {
    const harness = createHarness();
    harness.probe.start();

    harness.tick(50 + 500);
    harness.tick(50);
    expect(harness.probe.peek().samples).toBe(2);

    harness.probe.stop();
    harness.tick(50);
    expect(harness.probe.peek().samples).toBe(0);
  });
});
