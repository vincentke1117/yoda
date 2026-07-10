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
  overlay.style.display = 'block';
  pty.ownedContainer.appendChild(overlay);
  return overlay;
}

describe('FrontendPty.commitResize', () => {
  let pty: FrontendPty | null = null;

  afterEach(() => {
    pty?.dispose();
    pty = null;
  });

  it('does not keep an old freeze frame over a wider resize', () => {
    pty = new FrontendPty('session-grow');
    pty.flushPendingWrites();
    pty.terminal.resize(120, 32);

    const overlay = createOverlay(pty);
    setFreezeState(pty, overlay, 'idle');

    pty.commitResize(133, 32);

    expect(pty.terminal.cols).toBe(133);
    expect(overlay.style.display).toBe('none');
  });

  it('keeps the freeze frame when shrinking until the unfreeze chain runs', () => {
    pty = new FrontendPty('session-shrink');
    pty.flushPendingWrites();
    pty.terminal.resize(133, 32);

    const overlay = createOverlay(pty);
    setFreezeState(pty, overlay, 'idle');

    pty.commitResize(120, 32);

    expect(pty.terminal.cols).toBe(120);
    expect(overlay.style.display).toBe('block');
  });
});
