import { hostPreviewEventChannel } from '@shared/events/hostPreviewEvents';
import type { HostPreviewEvent } from '@shared/hostPreview';
import { events } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';

/**
 * A dev server Yoda detected on any PTY: a quick-action command or workspace
 * lifecycle script that printed a reachable localhost URL. The task-scoped
 * `DevServerStore` filters `hostPreviewEventChannel` by one task/workspace; this
 * singleton keeps the same map unfiltered so the runtime-bar can count running
 * backend processes across every project at once.
 */
export type GlobalBackendDevServer = {
  taskId: string;
  terminalId: string;
  url: string;
};

function devServerKey(taskId: string, terminalId: string): string {
  return `${taskId}\0${terminalId}`;
}

class GlobalBackendDevServersStore {
  readonly servers = new Resource<Map<string, GlobalBackendDevServer>, HostPreviewEvent>(
    null,
    [
      {
        kind: 'event',
        subscribe: (handler) => events.on(hostPreviewEventChannel, handler),
        onEvent: (event, ctx) => {
          const next = new Map(ctx.data ?? []);
          if (event.type === 'url' && event.taskId && event.terminalId && event.url) {
            next.set(devServerKey(event.taskId, event.terminalId), {
              taskId: event.taskId,
              terminalId: event.terminalId,
              url: event.url,
            });
          } else if (event.type === 'exit' && event.terminalId) {
            for (const [key, server] of next) {
              if (server.terminalId === event.terminalId) next.delete(key);
            }
          }
          ctx.set(next);
        },
      },
    ],
    { init: new Map() }
  );

  constructor() {
    this.servers.start();
  }

  get list(): GlobalBackendDevServer[] {
    return Array.from(this.servers.data?.values() ?? []);
  }
}

export const globalBackendDevServers = new GlobalBackendDevServersStore();
