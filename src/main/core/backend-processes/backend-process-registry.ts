import type { AppBackendProcessResource } from '@shared/app-resource';

export type BackendProcessInfo = AppBackendProcessResource;

export type ActiveBackendProcessSummary = {
  running: number;
  keepable: number;
  nonKeepableSessions: BackendProcessInfo[];
};

/**
 * Tracks the long-lived child processes the user started inside Yoda (AI Lab
 * App previews, the mobile Metro bundler). It is a pure in-memory map — no
 * Electron imports — so it can be unit-tested directly and both the quit
 * confirmation and the runtime-bar snapshot read the same source of truth.
 *
 * Detachability mirrors workspace terminals: a detachable process may keep
 * running after Yoda quits (Metro's detached process group + pid-file
 * reclamation); a non-detachable one (App preview) stops with the app.
 */
class BackendProcessRegistry {
  private readonly processes = new Map<string, BackendProcessInfo>();

  register(key: string, info: BackendProcessInfo): void {
    this.processes.set(key, info);
  }

  unregister(key: string): void {
    this.processes.delete(key);
  }

  list(): BackendProcessInfo[] {
    return Array.from(this.processes.values());
  }

  getActiveSessionSummary(): ActiveBackendProcessSummary {
    const processes = this.list();
    return {
      running: processes.length,
      keepable: processes.filter((process) => process.detachable).length,
      nonKeepableSessions: processes.filter((process) => !process.detachable),
    };
  }
}

export const backendProcessRegistry = new BackendProcessRegistry();
