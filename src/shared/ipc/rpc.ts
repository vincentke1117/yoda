import { type IpcMain, type IpcMainInvokeEvent } from 'electron';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProcedureMap = Record<string, (...args: any[]) => unknown>;

const eventProcedureHandler = Symbol('eventProcedureHandler');

type EventProcedure<Args extends unknown[], Result> = ((...args: Args) => Result) & {
  [eventProcedureHandler]: (event: IpcMainInvokeEvent | undefined, ...args: Args) => Result;
};

/**
 * Declare the rare RPC whose implementation needs `event.sender` while keeping
 * that transport-only argument out of the renderer client signature.
 * Direct controller tests invoke the returned procedure with an undefined
 * event; production registration supplies Electron's real invoke event.
 */
export function createEventRPCProcedure<Args extends unknown[], Result>(
  handler: (event: IpcMainInvokeEvent | undefined, ...args: Args) => Result
): (...args: Args) => Result {
  const procedure = ((...args: Args) => handler(undefined, ...args)) as EventProcedure<
    Args,
    Result
  >;
  procedure[eventProcedureHandler] = handler;
  return procedure;
}

export function createRPCController<T extends ProcedureMap>(handlers: T): T {
  return handlers;
}

type RouterMap = Record<string, ProcedureMap>;

export function createRPCRouter<T extends RouterMap>(routers: T): T {
  return routers;
}

/**
 * Observe how long a handler held the thread before returning.
 *
 * Only the synchronous prefix is reported — the work done before the handler's
 * first await. That is the part that blocks everything else on the thread,
 * including PTY reads and flushes; total promise duration would conflate it
 * with time spent legitimately waiting on I/O.
 */
export type RpcSyncDurationObserver = (channel: string, syncMs: number) => void;

export function registerRPCRouter(
  router: RouterMap,
  ipcMain: IpcMain,
  onSyncDuration?: RpcSyncDurationObserver
): void {
  for (const [ns, handlers] of Object.entries(router)) {
    for (const [key, fn] of Object.entries(handlers)) {
      const channel = `${ns}.${key}`;
      const eventHandler = (fn as Partial<EventProcedure<unknown[], unknown>>)[
        eventProcedureHandler
      ];
      const invoke = (event: unknown, args: unknown[]) =>
        eventHandler
          ? eventHandler(event as never, ...args)
          : (fn as (...a: unknown[]) => unknown)(...args);
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (!onSyncDuration) return invoke(event, args);
        const startedAt = performance.now();
        try {
          return invoke(event, args);
        } finally {
          onSyncDuration(channel, performance.now() - startedAt);
        }
      });
    }
  }
}

type IpcClient<R extends RouterMap> = {
  [NS in keyof R]: {
    [P in keyof R[NS]]: R[NS][P] extends (...args: infer A) => infer Ret
      ? (...args: A) => Promise<Awaited<Ret>>
      : never;
  };
};

export function createRPCClient<Router extends RouterMap>(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
): IpcClient<Router> {
  return new Proxy(
    {},
    {
      get(_, ns: string) {
        if (typeof ns !== 'string' || ns === 'then') return undefined;
        return new Proxy(
          {},
          {
            get(_, procedure: string) {
              if (typeof procedure !== 'string' || procedure === 'then') return undefined;
              return (...args: unknown[]) => invoke(`${ns}.${procedure}`, ...args);
            },
          }
        );
      },
    }
  ) as IpcClient<Router>;
}
