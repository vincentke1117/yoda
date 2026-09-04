import type { PtyExitInfo } from '../pty';

/**
 * Wire format between the main process and the PTY host.
 *
 * The host exists because the work that stalls Electron's main thread is not
 * JavaScript we can optimise: measured over several minutes, no RPC handler
 * crossed 16ms and the slowest SQLite query was 49ms, yet the loop still lost
 * 107-689ms at a time to native Chromium and window work. A PTY read cannot be
 * protected from that on the same loop, only moved off it.
 *
 * Every message names a session, so one host serves all of them.
 */
export type PtyHostRequest =
  | {
      type: 'spawn';
      id: string;
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      cols: number;
      rows: number;
    }
  | { type: 'write'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'pause'; id: string }
  | { type: 'resume'; id: string }
  | { type: 'kill'; id: string };

export type PtyHostEvent =
  | { type: 'ready' }
  | { type: 'spawned'; id: string; pid: number }
  | { type: 'spawn-failed'; id: string; message: string }
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; info: PtyExitInfo }
  /** A resize the backend PTY rejected, so main can stop believing the new grid. */
  | { type: 'resize-rejected'; id: string; cols: number; rows: number };

/** Environment flag that routes new local PTYs through the host process. */
export const PTY_HOST_ENV_FLAG = 'YODA_PTY_HOST';

export function isPtyHostEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PTY_HOST_ENV_FLAG] === '1';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Narrow a value that arrived over the process channel.
 *
 * The channel is trusted, but a version skew between a running host and a
 * reloaded main process is not: a malformed message must be dropped rather than
 * throw inside the message handler and take the host down with it.
 */
export function parsePtyHostEvent(value: unknown): PtyHostEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'ready':
      return { type: 'ready' };
    case 'spawned':
      return typeof value.id === 'string' && typeof value.pid === 'number'
        ? { type: 'spawned', id: value.id, pid: value.pid }
        : null;
    case 'spawn-failed':
      return typeof value.id === 'string' && typeof value.message === 'string'
        ? { type: 'spawn-failed', id: value.id, message: value.message }
        : null;
    case 'data':
      return typeof value.id === 'string' && typeof value.data === 'string'
        ? { type: 'data', id: value.id, data: value.data }
        : null;
    case 'exit':
      return typeof value.id === 'string' && isRecord(value.info)
        ? { type: 'exit', id: value.id, info: value.info as PtyExitInfo }
        : null;
    case 'resize-rejected':
      return typeof value.id === 'string' &&
        typeof value.cols === 'number' &&
        typeof value.rows === 'number'
        ? { type: 'resize-rejected', id: value.id, cols: value.cols, rows: value.rows }
        : null;
    default:
      return null;
  }
}

export function parsePtyHostRequest(value: unknown): PtyHostRequest | null {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.id !== 'string') {
    return null;
  }
  const id = value.id;
  switch (value.type) {
    case 'spawn':
      return typeof value.command === 'string' &&
        Array.isArray(value.args) &&
        typeof value.cwd === 'string' &&
        isRecord(value.env) &&
        typeof value.cols === 'number' &&
        typeof value.rows === 'number'
        ? {
            type: 'spawn',
            id,
            command: value.command,
            args: value.args.filter((arg): arg is string => typeof arg === 'string'),
            cwd: value.cwd,
            env: value.env as Record<string, string>,
            cols: value.cols,
            rows: value.rows,
          }
        : null;
    case 'write':
      return typeof value.data === 'string' ? { type: 'write', id, data: value.data } : null;
    case 'resize':
      return typeof value.cols === 'number' && typeof value.rows === 'number'
        ? { type: 'resize', id, cols: value.cols, rows: value.rows }
        : null;
    case 'pause':
      return { type: 'pause', id };
    case 'resume':
      return { type: 'resume', id };
    case 'kill':
      return { type: 'kill', id };
    default:
      return null;
  }
}
