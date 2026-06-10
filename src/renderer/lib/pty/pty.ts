import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type IDisposable, type ITerminalOptions } from '@xterm/xterm';
import { ptyDataChannel } from '@shared/events/ptyEvents';
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from '@shared/terminal-settings';
import { events, rpc } from '@renderer/lib/ipc';
import { cssVar } from '@renderer/utils/cssVars';
import { log } from '@renderer/utils/logger';
import { ensureXtermHost } from './xterm-host';

// ── Theme helpers ─────────────────────────────────────────────────────────────

export interface SessionTheme {
  override?: ITerminalOptions['theme'];
}

/**
 * xterm's renderers only fully support lineHeight 1.0. Any other value makes
 * each rendered row taller than the glyph cell, so on scroll the renderer
 * clears a vertically-misaligned region and the outgoing row's left cells
 * aren't erased before the incoming row paints — the left-gutter ghosting seen
 * during scroll. Keep this at 1.0; add row spacing via container CSS if needed,
 * never via xterm lineHeight.
 */
export const TERMINAL_LINE_HEIGHT = 1.0;

export const DEFAULT_TERMINAL_FONT_FAMILY = [
  'Menlo',
  'Monaco',
  'Consolas',
  '"Liberation Mono"',
  '"Noto Sans Mono CJK SC"',
  '"Noto Sans Mono CJK TC"',
  '"Noto Sans Mono CJK JP"',
  '"PingFang SC"',
  '"Microsoft YaHei UI"',
  'monospace',
].join(', ');

export function buildTerminalFontFamily(fontFamily?: string): string {
  const trimmed = fontFamily?.trim();
  if (!trimmed) return DEFAULT_TERMINAL_FONT_FAMILY;
  return `${trimmed}, ${DEFAULT_TERMINAL_FONT_FAMILY}`;
}

export function readXtermCssVars(): ITerminalOptions['theme'] {
  return {
    background: cssVar('--xterm-bg'),
    foreground: cssVar('--xterm-fg'),
    cursor: cssVar('--xterm-cursor'),
    cursorAccent: cssVar('--xterm-cursor-accent'),
    selectionBackground: cssVar('--xterm-selection-bg'),
    selectionForeground: cssVar('--xterm-selection-fg'),
  };
}

export function buildTheme(theme?: SessionTheme): ITerminalOptions['theme'] {
  if (theme?.override) return { ...readXtermCssVars(), ...theme.override };
  return readXtermCssVars();
}

// ── FrontendPty ───────────────────────────────────────────────────────────────

/**
 * Frontend counterpart to the main-process Pty interface.
 *
 * Owns the xterm Terminal instance for the full lifetime of the session.
 * The terminal is created synchronously during construction and opened into
 * an off-screen container. Call connect() to subscribe to the main-process
 * ring buffer and live IPC events — this writes historical output directly
 * to xterm and sets up ongoing data delivery without any renderer-side buffer.
 *
 * DOM management is handled via mount() / unmount():
 *  - mount()   → appends ownedContainer to the visible mount target
 *  - unmount() → moves ownedContainer back to the off-screen host
 *
 * Lifecycle: created and owned by PtySession (stores/pty-session.ts), one per
 * live session. Survives React component unmounts (e.g. navigating away from a
 * task), and is disposed only when the entity (terminal or conversation) is
 * explicitly deleted.
 */
export class FrontendPty {
  /** All live FrontendPty instances — used for app-wide operations (e.g. theme updates). */
  static readonly all = new Set<FrontendPty>();

  /**
   * Record the dimensions last sent to the backend for a session. Called by
   * every resize path (per-session and pane broadcast) so that a restart can
   * spawn the new PTY at the real pane size instead of the 80x24 fallback —
   * without this, a restarted tmux/TUI session is born at 24 rows and only
   * paints the top half of the pane.
   */
  /**
   * Record the dims sent to the backend PTY for this session. Returns true
   * when they DIFFER from the previously recorded dims — i.e. the rpc.pty
   * resize must actually be sent. Per-session (not per-pane) so a session
   * moving between panes (pin/unpin) is never deduped against a stale pane
   * broadcast.
   */
  static noteResize(sessionId: string, cols: number, rows: number): boolean {
    for (const pty of FrontendPty.all) {
      if (pty.sessionId === sessionId) {
        const changed = pty.lastSentDims?.cols !== cols || pty.lastSentDims?.rows !== rows;
        pty.lastSentDims = { cols, rows };
        return changed;
      }
    }
    // Unknown session — never skip the resize.
    return true;
  }
  readonly terminal: Terminal;
  readonly ownedContainer: HTMLDivElement;
  private offData: (() => void) | null = null;
  /** Last { cols, rows } sent to rpc.pty.resize(). Used by PaneSizingContext to skip redundant IPC calls. */
  lastSentDims: { cols: number; rows: number } | null = null;
  /**
   * Buffered output (historical + any live data) held while the terminal is
   * still off-screen at the constructor default cols/rows. Flushed on first
   * mount() after the terminal has been resized to real pane dimensions, so
   * scrollback never reflows from a stale default width.
   */
  private pendingWrites: string[] = [];
  private hasFlushed = false;
  private savedViewportY: number | null = null;
  /** Deferred terminal.resize, applied on the next data chunk (or timeout). */
  private deferredResize: {
    cols: number;
    rows: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly scrollDisposable: { dispose(): void };
  private webglAddon: WebglAddon | null = null;
  private webglContextLossDisposable: IDisposable | null = null;

  constructor(
    readonly sessionId: string,
    theme?: SessionTheme,
    options?: { scrollbackLines?: number }
  ) {
    this.ownedContainer = document.createElement('div');
    Object.assign(this.ownedContainer.style, {
      width: '100%',
      height: '100%',
    });

    this.terminal = new Terminal({
      cols: 120,
      rows: 32,
      scrollback: normalizeTerminalScrollbackLines(
        options?.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK_LINES
      ),
      convertEol: true,
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      fontSize: 13,
      lineHeight: TERMINAL_LINE_HEIGHT,
      letterSpacing: 0,
      reflowCursorLine: true,
      rescaleOverlappingGlyphs: true,
      allowProposedApi: true,
      macOptionClickForcesSelection: true,
      minimumContrastRatio: 4.5,
      scrollOnUserInput: false,
      linkHandler: {
        activate: (_event: MouseEvent, text: string) => {
          rpc.app.openExternal(text).catch((error) => {
            log.warn('FrontendPty: failed to open external link', { text, error });
          });
        },
      },
      theme: buildTheme(theme),
    });

    this.terminal.open(this.ownedContainer);
    this.loadWebglRenderer();
    this.scrollDisposable = this.terminal.onScroll((viewportY) => {
      this.savedViewportY = viewportY;
    });

    const el = (this.terminal as unknown as { element?: HTMLElement }).element;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.backgroundColor = 'transparent';
    }

    ensureXtermHost().appendChild(this.ownedContainer);
    FrontendPty.all.add(this);
  }

  private loadWebglRenderer(): void {
    try {
      const webglAddon = new WebglAddon();
      const contextLossDisposable = webglAddon.onContextLoss(() => {
        log.warn('FrontendPty: WebGL renderer context lost; falling back to DOM renderer', {
          sessionId: this.sessionId,
        });
        this.webglContextLossDisposable?.dispose();
        this.webglContextLossDisposable = null;
        this.webglAddon?.dispose();
        this.webglAddon = null;
        this.terminal.refresh(0, Math.max(0, this.terminal.rows - 1));
      });
      this.terminal.loadAddon(webglAddon);
      this.webglAddon = webglAddon;
      this.webglContextLossDisposable = contextLossDisposable;
    } catch (error) {
      log.debug('FrontendPty: WebGL renderer unavailable; using DOM renderer', {
        sessionId: this.sessionId,
        error: String(error),
      });
      this.webglContextLossDisposable?.dispose();
      this.webglContextLossDisposable = null;
      this.webglAddon?.dispose();
      this.webglAddon = null;
    }
  }

  setScrollbackLines(scrollbackLines: unknown): void {
    this.terminal.options.scrollback = normalizeTerminalScrollbackLines(scrollbackLines);
  }

  /**
   * Subscribe to the session: fetches the ring buffer from the main process,
   * writes it directly to xterm, then sets up a live IPC listener for future
   * data. Marks status as 'ready' once complete.
   *
   * The main process guarantees atomicity: subscribe() snapshots the ring
   * buffer and registers the consumer in one synchronous tick, so no data
   * can slip between the snapshot and the first live IPC event.
   */
  async connect(): Promise<void> {
    const result = await rpc.pty.subscribe(this.sessionId);
    const historical = result.success ? result.data.buffer : '';
    if (historical) this.writeOrBuffer(historical);
    this.offData = events.on(
      ptyDataChannel,
      (data: string) => {
        this.writeOrBuffer(data);
      },
      this.sessionId
    );
  }

  /**
   * Does this chunk look like a TUI full-screen repaint rather than an
   * incremental update?  Incremental writes use positioned CUPs only
   * (`\x1b[35;1H…`), while a full repaint homes the cursor (bare `\x1b[H`),
   * clears the screen, or switches the alt buffer.  Deliberately NO size
   * heuristic: large chunks can be plain streamed output or OSC52 clipboard
   * payloads, and a false positive here paints rewrap garbage.
   */
  private static looksLikeRepaint(data: string): boolean {
    return (
      data.includes('\x1b[H') ||
      data.includes('\x1b[2J') ||
      data.includes('\x1b[3J') ||
      data.includes('\x1b[?1049')
    );
  }

  private writeOrBuffer(data: string): void {
    if (this.hasFlushed) {
      // Apply a deferred reflow only when the app's repaint frame arrives, so
      // the rewrapped viewport is overwritten by the new frame in the same
      // tick (before the next paint).  Incremental chunks (spinners, streamed
      // output) must NOT trigger it — they'd expose the rewrap garbage for
      // the 30-100ms until the real repaint lands.
      if (this.deferredResize && FrontendPty.looksLikeRepaint(data)) {
        this.applyDeferredResize();
      }
      this.terminal.write(data);
    } else {
      this.pendingWrites.push(data);
    }
  }

  /**
   * Apply a resize without ever painting forced-rewrap garbage.
   *
   * xterm's resize is asymmetric:
   *  - Cols GROWTH never force-wraps existing lines (it only unwraps
   *    previously wrapped ones) — that reflow is correct by construction, so
   *    growth applies immediately: live reflow with no garbage possible.
   *  - Cols SHRINK force-wraps every line longer than the new width, which
   *    garbles absolutely-positioned TUI screens — and apps like Claude Code
   *    debounce their resize repaint, so the garbage would stay on screen for
   *    the whole drag.  Instead the PTY learns the new size immediately (the
   *    app starts rendering at the narrow width right away) while the
   *    terminal keeps its wider grid — narrow content on a wide grid renders
   *    fine, zero visual debt.  The shrink lands either when a full-screen
   *    repaint arrives (vim-class apps repaint per SIGWINCH — atomic swap in
   *    writeOrBuffer) or `settleMs` after the LAST resize report (drag
   *    settled; by then on-screen content is already narrow, so the shrink
   *    wraps nothing).  Resetting the timer per report is deliberate — the
   *    deferral shows a correct frame, so there is nothing to starve.
   *
   * Rows-only changes never rewrap, and a terminal that hasn't flushed its
   * historical buffer yet has no frame worth protecting — both apply
   * immediately.
   */
  requestResize(cols: number, rows: number, settleMs: number): void {
    if (this.terminal.cols === cols && this.terminal.rows === rows) {
      this.cancelDeferredResize();
      return;
    }
    if (cols >= this.terminal.cols || !this.hasFlushed) {
      this.cancelDeferredResize();
      this.terminal.resize(cols, rows);
      return;
    }
    // Cols shrink: rows apply now, the cols shrink waits for repaint/settle.
    if (this.terminal.rows !== rows) {
      this.terminal.resize(this.terminal.cols, rows);
    }
    this.cancelDeferredResize();
    const timer = setTimeout(() => this.applyDeferredResize(), settleMs);
    this.deferredResize = { cols, rows, timer };
  }

  private applyDeferredResize(): void {
    const pending = this.deferredResize;
    if (!pending) return;
    this.cancelDeferredResize();
    if (this.terminal.cols !== pending.cols || this.terminal.rows !== pending.rows) {
      this.terminal.resize(pending.cols, pending.rows);
    }
  }

  private cancelDeferredResize(): void {
    if (!this.deferredResize) return;
    clearTimeout(this.deferredResize.timer);
    this.deferredResize = null;
  }

  /**
   * Flush any output that was buffered while the terminal was off-screen at
   * default cols/rows. Called by usePty once the terminal has been resized to
   * real pane dimensions, so historical scrollback is wrapped at the correct
   * width. Idempotent — no-op after the first call.
   */
  flushPendingWrites(): void {
    if (this.hasFlushed) return;
    this.hasFlushed = true;
    if (this.pendingWrites.length === 0) return;
    const buffered = this.pendingWrites.join('');
    this.pendingWrites = [];
    this.terminal.write(buffered, () => {
      try {
        this.terminal.scrollToBottom();
        this.savedViewportY = this.terminal.buffer.active.viewportY;
        this.terminal.refresh(0, this.terminal.rows - 1);
      } catch {}
    });
  }

  /**
   * Append ownedContainer to a visible mount target.
   * If targetDims are provided the terminal is resized BEFORE the appendChild
   * to eliminate the flash caused by a post-mount resize.
   */
  mount(mountTarget: HTMLElement, targetDims?: { cols: number; rows: number }): void {
    // Mount dims are authoritative — drop any stale deferred reflow.
    this.cancelDeferredResize();
    if (
      targetDims &&
      (this.terminal.cols !== targetDims.cols || this.terminal.rows !== targetDims.rows)
    ) {
      this.terminal.resize(targetDims.cols, targetDims.rows);
    }
    mountTarget.appendChild(this.ownedContainer);
    // Force a Canvas2D repaint after reparenting in the DOM.
    const t = this.terminal;
    const savedViewportY = this.savedViewportY;
    requestAnimationFrame(() => {
      try {
        if ((t as unknown as { _isDisposed?: boolean })._isDisposed) return;
        if (savedViewportY !== null) {
          t.scrollToLine(savedViewportY);
        }
        t.refresh(0, t.rows - 1);
      } catch {}
    });
  }

  /**
   * Move ownedContainer back to the off-screen host (tab deactivated /
   * TerminalPane unmounting).  Must be called after all ResizeObservers on
   * the visible mount target have been disconnected.
   */
  unmount(): void {
    ensureXtermHost().appendChild(this.ownedContainer);
  }

  /**
   * Permanently dispose this session (terminal or conversation deleted).
   * Unsubscribes from the main process, tears down the IPC data listener,
   * disposes the xterm Terminal, and removes the owned container from the DOM.
   */
  dispose(): void {
    FrontendPty.all.delete(this);
    this.cancelDeferredResize();
    this.offData?.();
    this.offData = null;
    this.scrollDisposable.dispose();
    this.webglContextLossDisposable?.dispose();
    this.webglContextLossDisposable = null;
    this.webglAddon?.dispose();
    this.webglAddon = null;
    rpc.pty.unsubscribe(this.sessionId).catch(() => {});
    try {
      this.terminal.dispose();
    } catch {}
    try {
      this.ownedContainer.remove();
    } catch {}
  }
}

// ── App-wide helpers ──────────────────────────────────────────────────────────

/** Apply a theme to all live terminals. Called on app-level theme change. */
export function applyThemeToAll(theme?: SessionTheme): void {
  const xTermTheme = buildTheme(theme);
  for (const pty of FrontendPty.all) {
    pty.terminal.options.theme = xTermTheme;
  }
}

/**
 * Apply the canonical lineHeight to every live terminal. lineHeight is set at
 * construction, so terminals that survive an HMR module swap keep the old value
 * until reconstructed. Calling this on module eval pushes the corrected value
 * to all existing sessions so a render-option fix lands everywhere immediately,
 * without forcing a new session.
 */
export function applyLineHeightToAll(): void {
  for (const pty of FrontendPty.all) {
    pty.terminal.options.lineHeight = TERMINAL_LINE_HEIGHT;
  }
}

applyLineHeightToAll();

/** Dispose all live FrontendPty instances. Called on app teardown. */
export function disposeAllPtys(): void {
  for (const pty of [...FrontendPty.all]) {
    pty.dispose();
  }
}
