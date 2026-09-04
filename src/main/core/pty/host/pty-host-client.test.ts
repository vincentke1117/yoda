import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyExitInfo } from '../pty';
import type { PtyHostEvent, PtyHostRequest } from './protocol';
import { PTY_HOST_LOST_EXIT_CODE, PtyHostClient, type PtyHostChannel } from './pty-host-client';

function createFakeChannel() {
  const posted: PtyHostRequest[] = [];
  let emit: ((event: PtyHostEvent) => void) | null = null;
  let close: ((reason: string) => void) | null = null;
  const channel: PtyHostChannel = {
    post: (request) => posted.push(request),
    onEvent: (handler) => {
      emit = handler;
    },
    onClosed: (handler) => {
      close = handler;
    },
    close: vi.fn(),
  };
  return {
    channel,
    posted,
    emit: (event: PtyHostEvent) => emit?.(event),
    closeHost: (reason: string) => close?.(reason),
  };
}

describe('PtyHostClient', () => {
  let fake: ReturnType<typeof createFakeChannel>;
  let client: PtyHostClient;
  let hostLost: string[];

  beforeEach(() => {
    fake = createFakeChannel();
    hostLost = [];
    client = new PtyHostClient({
      createChannel: () => fake.channel,
      onHostLost: (reason) => hostLost.push(reason),
    });
  });

  function spawn(id = 'session') {
    return client.spawn({
      id,
      command: '/bin/zsh',
      args: ['-l'],
      cwd: '/tmp',
      env: { TERM: 'xterm-256color' },
      cols: 120,
      rows: 30,
    });
  }

  it('starts one host lazily and reuses it for later sessions', () => {
    const createChannel = vi.fn(() => fake.channel);
    const lazy = new PtyHostClient({ createChannel });

    expect(createChannel).not.toHaveBeenCalled();
    lazy.spawn({
      id: 'a',
      command: 'sh',
      args: [],
      cwd: '/tmp',
      env: {},
      cols: 80,
      rows: 24,
    });
    lazy.spawn({
      id: 'b',
      command: 'sh',
      args: [],
      cwd: '/tmp',
      env: {},
      cols: 80,
      rows: 24,
    });
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(lazy.sessionCount).toBe(2);
  });

  it('posts input straight through, since the channel preserves order', () => {
    const pty = spawn();
    pty.write('first');
    pty.write('second');

    expect(fake.posted.map((request) => request.type)).toEqual(['spawn', 'write', 'write']);
    expect(fake.posted.at(-1)).toEqual({ type: 'write', id: 'session', data: 'second' });
  });

  it('fills in the pid when the host reports it and routes data by session', () => {
    const first = spawn('first');
    const second = spawn('second');
    const firstChunks: string[] = [];
    const secondChunks: string[] = [];
    first.onData((data) => firstChunks.push(data));
    second.onData((data) => secondChunks.push(data));

    fake.emit({ type: 'spawned', id: 'first', pid: 4242 });
    fake.emit({ type: 'data', id: 'first', data: 'hello' });
    fake.emit({ type: 'data', id: 'second', data: 'other' });

    expect(first.pid).toBe(4242);
    expect(second.pid).toBeUndefined();
    expect(firstChunks).toEqual(['hello']);
    expect(secondChunks).toEqual(['other']);
  });

  it('delivers a spawn failure as a terminal event the caller can observe', () => {
    const pty = spawn();
    const exits: PtyExitInfo[] = [];
    pty.onExit((info) => exits.push(info));

    fake.emit({ type: 'spawn-failed', id: 'session', message: 'ENOENT' });

    expect(exits).toEqual([{ exitCode: PTY_HOST_LOST_EXIT_CODE }]);
    expect(client.sessionCount).toBe(0);
  });

  it('reports exit exactly once and stops forwarding afterwards', () => {
    const pty = spawn();
    const chunks: string[] = [];
    const exits: PtyExitInfo[] = [];
    pty.onData((data) => chunks.push(data));
    pty.onExit((info) => exits.push(info));

    fake.emit({ type: 'exit', id: 'session', info: { exitCode: 0 } });
    fake.emit({ type: 'exit', id: 'session', info: { exitCode: 9 } });
    fake.emit({ type: 'data', id: 'session', data: 'after-exit' });

    expect(exits).toEqual([{ exitCode: 0 }]);
    expect(chunks).toEqual([]);
  });

  it('does not post for a session that already exited', () => {
    const pty = spawn();
    fake.emit({ type: 'exit', id: 'session', info: { exitCode: 0 } });
    const postedAfterExit = fake.posted.length;

    pty.write('ignored');
    pty.resize(10, 10);
    pty.kill();

    expect(fake.posted).toHaveLength(postedAfterExit);
  });

  it('exits every live session when the host dies, then starts a fresh one', () => {
    const first = spawn('first');
    const second = spawn('second');
    const exits: string[] = [];
    first.onExit(() => exits.push('first'));
    second.onExit(() => exits.push('second'));

    fake.closeHost('host crashed');

    expect(exits).toEqual(['first', 'second']);
    expect(client.sessionCount).toBe(0);
    expect(hostLost).toEqual(['host crashed']);

    // The next spawn must not reuse the dead channel.
    const revived = createFakeChannel();
    const revivedClient = new PtyHostClient({ createChannel: () => revived.channel });
    revivedClient.spawn({
      id: 'again',
      command: 'sh',
      args: [],
      cwd: '/tmp',
      env: {},
      cols: 80,
      rows: 24,
    });
    expect(revived.posted[0]?.type).toBe('spawn');
  });

  it('closes the channel and settles sessions on shutdown', () => {
    const pty = spawn();
    const exits: PtyExitInfo[] = [];
    pty.onExit((info) => exits.push(info));

    client.shutdown();

    expect(exits).toEqual([{ exitCode: PTY_HOST_LOST_EXIT_CODE }]);
    expect(fake.channel.close).toHaveBeenCalledTimes(1);
  });
});
