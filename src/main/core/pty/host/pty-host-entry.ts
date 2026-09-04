import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { normalizeSignal } from '../exit-signals';
import { suppressExpectedNodePtyErrors } from '../node-pty-errors';
import { parsePtyHostRequest, type PtyHostEvent } from './protocol';

/**
 * The PTY host process.
 *
 * It owns every hosted node-pty handle and does nothing else, so reading a PTY
 * is never queued behind the native Chromium and window work that stalls
 * Electron's main thread for 100ms at a time.
 *
 * Deliberately dependency-free beyond node-pty: this process must not import
 * the database, the logger's file sink, or anything else that could give it its
 * own reasons to block.
 */

const MIN_COLS = 2;
const MIN_ROWS = 1;

const sessions = new Map<string, IPty>();

function post(event: PtyHostEvent): void {
  process.parentPort?.postMessage(event);
}

function spawn(request: Extract<ReturnType<typeof parsePtyHostRequest>, { type: 'spawn' }>): void {
  const { id, command, args, cwd, env, cols, rows } = request;
  // A repeated id would orphan the previous handle's reader; the caller owns
  // session identity, so treat it as a programming error it can see.
  if (sessions.has(id)) {
    post({ type: 'spawn-failed', id, message: `PTY host already owns session ${id}` });
    return;
  }
  let proc: IPty;
  try {
    proc = nodePty.spawn(command, args, {
      name: 'xterm-256color',
      cols: Math.max(MIN_COLS, Math.floor(cols)),
      rows: Math.max(MIN_ROWS, Math.floor(rows)),
      cwd,
      env,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: 'spawn-failed', id, message });
    return;
  }
  suppressExpectedNodePtyErrors(proc);
  sessions.set(id, proc);
  proc.onData((data) => post({ type: 'data', id, data }));
  proc.onExit(({ exitCode, signal }) => {
    sessions.delete(id);
    post({ type: 'exit', id, info: { exitCode, signal: normalizeSignal(signal) } });
  });
  post({ type: 'spawned', id, pid: proc.pid });
}

function resize(id: string, cols: number, rows: number): void {
  const proc = sessions.get(id);
  if (!proc) return;
  const safeCols = Number.isFinite(cols) ? Math.max(MIN_COLS, Math.floor(cols)) : MIN_COLS;
  const safeRows = Number.isFinite(rows) ? Math.max(MIN_ROWS, Math.floor(rows)) : MIN_ROWS;
  try {
    proc.resize(safeCols, safeRows);
  } catch (error: unknown) {
    // Mirrors LocalPtySession: a closed or detached PTY rejects the grid, and
    // main must learn that so it does not keep believing the new size.
    const message = error instanceof Error ? error.message : String(error);
    if (!/EBADF|ENOTTY|ioctl\(2\) failed|not open|Napi::Error/.test(message)) {
      process.stderr.write(`[pty-host] resize failed for ${id}: ${message}\n`);
    }
    post({ type: 'resize-rejected', id, cols: safeCols, rows: safeRows });
  }
}

process.parentPort?.on('message', (message) => {
  const request = parsePtyHostRequest(message.data);
  if (!request) return;
  const proc = sessions.get(request.id);
  switch (request.type) {
    case 'spawn':
      spawn(request);
      return;
    case 'write':
      proc?.write(request.data);
      return;
    case 'resize':
      resize(request.id, request.cols, request.rows);
      return;
    case 'pause':
      proc?.pause();
      return;
    case 'resume':
      proc?.resume();
      return;
    case 'kill':
      proc?.kill();
      return;
  }
});

post({ type: 'ready' });
