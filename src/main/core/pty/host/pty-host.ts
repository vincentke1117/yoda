import { fileURLToPath } from 'node:url';
import { utilityProcess, type UtilityProcess } from 'electron';
import { log } from '@main/lib/logger';
import type { Pty } from '../pty';
import { parsePtyHostEvent, type PtyHostRequest } from './protocol';
import { PtyHostClient, type PtyHostChannel, type PtyHostSpawnOptions } from './pty-host-client';

export type ForkPtyHost = (modulePath: string) => UtilityProcess;

const hostEntryPath = () => fileURLToPath(new URL('./pty-host/entry.js', import.meta.url));

/**
 * Bridge the client's transport contract onto an Electron utility process.
 *
 * `utilityProcess` is what the repo already uses for the MaaS gateway, and it
 * runs a plain Node entry point with the same native-module ABI as main — which
 * node-pty needs.
 */
export function createUtilityProcessChannel(
  fork: ForkPtyHost = (modulePath) => utilityProcess.fork(modulePath),
  modulePath: string = hostEntryPath()
): PtyHostChannel {
  const child = fork(modulePath);
  let closedHandler: ((reason: string) => void) | null = null;
  let closed = false;

  const reportClosed = (reason: string) => {
    if (closed) return;
    closed = true;
    closedHandler?.(reason);
  };

  child.on('exit', (code: number) => reportClosed(`pty host exited with code ${code}`));

  return {
    post: (request: PtyHostRequest) => {
      if (closed) return;
      child.postMessage(request);
    },
    onEvent: (handler) => {
      child.on('message', (message: unknown) => {
        const event = parsePtyHostEvent(message);
        if (event) handler(event);
      });
    },
    onClosed: (handler) => {
      closedHandler = handler;
    },
    close: () => {
      if (closed) return;
      closed = true;
      child.kill();
    },
  };
}

let client: PtyHostClient | null = null;

function ptyHostClient(): PtyHostClient {
  if (client) return client;
  client = new PtyHostClient({
    createChannel: () => createUtilityProcessChannel(),
    onHostLost: (reason) => {
      // Every hosted session has already been reported as exited by the client;
      // this only records why, since the sessions themselves look like ordinary
      // process exits to their providers.
      log.error('[pty-host] host process lost', { reason });
    },
  });
  return client;
}

/** Spawn a PTY inside the host process. */
export function spawnHostedPty(options: PtyHostSpawnOptions): Pty {
  log.info('PtyHost:spawn', {
    id: options.id,
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
  });
  return ptyHostClient().spawn(options);
}

/** Tear the host down; used on app quit so no orphan process survives. */
export function shutdownPtyHost(): void {
  client?.shutdown();
  client = null;
}
