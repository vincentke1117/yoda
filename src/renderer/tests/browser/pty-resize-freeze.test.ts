import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontendPty } from '@renderer/lib/pty/pty';

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
  rpc: {
    app: {
      openExternal: vi.fn(),
    },
    pty: {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(() => Promise.resolve()),
    },
  },
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@renderer/lib/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

type PtyInternals = {
  freezeOverlay: HTMLCanvasElement | null;
  hasFreezeSnapshot: boolean;
  unfreezePhase: 'idle' | 'await-data' | 'await-render';
};

function setFreezeState(
  pty: FrontendPty,
  overlay: HTMLCanvasElement,
  phase: PtyInternals['unfreezePhase']
): void {
  const internals = pty as unknown as PtyInternals;
  internals.freezeOverlay = overlay;
  internals.hasFreezeSnapshot = true;
  internals.unfreezePhase = phase;
}

function createOverlay(pty: FrontendPty): HTMLCanvasElement {
  const overlay = document.createElement('canvas');
  overlay.width = 2;
  overlay.height = 2;
  const context = overlay.getContext('2d');
  if (!context) throw new Error('2D canvas is required for the resize snapshot test');
  context.fillStyle = '#ff00ff';
  context.fillRect(0, 0, overlay.width, overlay.height);
  overlay.style.display = 'none';
  pty.ownedContainer.appendChild(overlay);
  return overlay;
}

function expectSnapshotVisible(overlay: HTMLCanvasElement): void {
  expect(overlay.style.display).toBe('block');
  const pixel = overlay.getContext('2d')?.getImageData(0, 0, 1, 1).data;
  expect(Array.from(pixel ?? [])).toEqual([255, 0, 255, 255]);
}

describe('FrontendPty.commitResize', () => {
  let pty: FrontendPty | null = null;

  afterEach(() => {
    pty?.dispose();
    pty = null;
  });

  it('keeps the previous frame visible while a wider grid renders', async () => {
    pty = new FrontendPty('session-grow');
    pty.flushPendingWrites();
    pty.terminal.resize(120, 32);

    const overlay = createOverlay(pty);
    setFreezeState(pty, overlay, 'idle');

    pty.commitResize(133, 32);

    expect(pty.terminal.cols).toBe(133);
    expectSnapshotVisible(overlay);
    await vi.waitFor(() => expect(overlay.style.display).toBe('none'));
  });

  it('keeps visible pixels through an immediate shrink-to-grow reversal', async () => {
    pty = new FrontendPty('session-resize-reversal');
    pty.flushPendingWrites();
    pty.terminal.resize(133, 32);

    const overlay = createOverlay(pty);
    setFreezeState(pty, overlay, 'idle');

    pty.commitResize(120, 32);
    expectSnapshotVisible(overlay);

    pty.commitResize(140, 32);

    expect(pty.terminal.cols).toBe(140);
    expectSnapshotVisible(overlay);
    await vi.waitFor(() => expect(overlay.style.display).toBe('none'));
  });

  it('keeps the freeze frame when shrinking until the unfreeze chain runs', () => {
    pty = new FrontendPty('session-shrink');
    pty.flushPendingWrites();
    pty.terminal.resize(133, 32);

    const overlay = createOverlay(pty);
    setFreezeState(pty, overlay, 'idle');

    pty.commitResize(120, 32);

    expect(pty.terminal.cols).toBe(120);
    expectSnapshotVisible(overlay);
  });
});
