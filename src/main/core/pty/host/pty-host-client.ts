import type { Pty, PtyExitInfo } from '../pty';
import type { PtyHostEvent, PtyHostRequest } from './protocol';

export type PtyHostSpawnOptions = {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
};

/**
 * Transport to one PTY host process.
 *
 * Abstracted so the client can be tested without Electron, and so the same
 * client can later be pointed at a long-lived host that outlives the app.
 */
export type PtyHostChannel = {
  post(request: PtyHostRequest): void;
  onEvent(handler: (event: PtyHostEvent) => void): void;
  /** The host went away — crash, exit, or deliberate shutdown. */
  onClosed(handler: (reason: string) => void): void;
  close(): void;
};

/** Exit code reported when the host itself dies with sessions still running. */
export const PTY_HOST_LOST_EXIT_CODE = -1;

class HostedPtySession implements Pty {
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  private settled = false;
  pid: number | undefined;

  constructor(
    readonly id: string,
    private readonly send: (request: PtyHostRequest) => void
  ) {}

  write(data: string): void {
    if (this.settled) return;
    this.send({ type: 'write', id: this.id, data });
  }

  resize(cols: number, rows: number): void {
    if (this.settled) return;
    this.send({ type: 'resize', id: this.id, cols, rows });
  }

  pause(): void {
    if (this.settled) return;
    this.send({ type: 'pause', id: this.id });
  }

  resume(): void {
    if (this.settled) return;
    this.send({ type: 'resume', id: this.id });
  }

  kill(): void {
    if (this.settled) return;
    this.send({ type: 'kill', id: this.id });
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  emitData(data: string): void {
    if (this.settled) return;
    for (const handler of this.dataHandlers) handler(data);
  }

  /** Deliver the single terminal event for this session; further ones are dropped. */
  settle(info: PtyExitInfo): void {
    if (this.settled) return;
    this.settled = true;
    for (const handler of this.exitHandlers) handler(info);
    this.dataHandlers = [];
    this.exitHandlers = [];
  }
}

type PtyHostClientOptions = {
  createChannel: () => PtyHostChannel;
  onHostLost?: (reason: string) => void;
};

/**
 * Owns one PTY host process and the sessions living inside it.
 *
 * Message ordering on the channel is what keeps this simple: a `write` posted
 * immediately after `spawn` is processed by the host after the spawn, so
 * nothing has to be buffered here while a session starts. Only `pid` is
 * genuinely asynchronous, which the Pty interface already allows.
 */
export class PtyHostClient {
  private channel: PtyHostChannel | null = null;
  private readonly sessions = new Map<string, HostedPtySession>();

  constructor(private readonly options: PtyHostClientOptions) {}

  spawn(options: PtyHostSpawnOptions): Pty {
    const channel = this.ensureChannel();
    const session = new HostedPtySession(options.id, (request) => channel.post(request));
    this.sessions.set(options.id, session);
    channel.post({
      type: 'spawn',
      id: options.id,
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      env: options.env,
      cols: options.cols,
      rows: options.rows,
    });
    return session;
  }

  /** Live session count, for diagnostics and shutdown decisions. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  shutdown(): void {
    const channel = this.channel;
    this.channel = null;
    this.failAllSessions('pty host shut down');
    channel?.close();
  }

  private ensureChannel(): PtyHostChannel {
    if (this.channel) return this.channel;
    const channel = this.options.createChannel();
    this.channel = channel;
    channel.onEvent((event) => this.handleEvent(event));
    channel.onClosed((reason) => {
      if (this.channel !== channel) return;
      this.channel = null;
      this.failAllSessions(reason);
      this.options.onHostLost?.(reason);
    });
    return channel;
  }

  private handleEvent(event: PtyHostEvent): void {
    if (event.type === 'ready') return;
    const session = this.sessions.get(event.id);
    if (!session) return;
    switch (event.type) {
      case 'spawned':
        session.pid = event.pid;
        return;
      case 'data':
        session.emitData(event.data);
        return;
      case 'spawn-failed':
        // The caller subscribed to onExit in the same tick it received the Pty,
        // so reporting the failure as a terminal event reaches it, where a
        // synchronous throw from inside the host process could not.
        this.sessions.delete(event.id);
        session.settle({ exitCode: PTY_HOST_LOST_EXIT_CODE });
        return;
      case 'exit':
        this.sessions.delete(event.id);
        session.settle(event.info);
        return;
      case 'resize-rejected':
        return;
    }
  }

  /**
   * A dead host takes every session with it. Report each as an exit so the
   * registry and providers run their normal teardown instead of holding a
   * session that can never produce another byte.
   */
  private failAllSessions(_reason: string): void {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) session.settle({ exitCode: PTY_HOST_LOST_EXIT_CODE });
  }
}
