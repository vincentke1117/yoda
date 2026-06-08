import { makeAutoObservable, runInAction } from 'mobx';
import { ALL_WORKSPACES_ID, DEFAULT_WORKSPACE_ID, type Workspace } from '@shared/workspaces';
import { rpc } from '@renderer/lib/ipc';

/** Active selection: a virtual id ("all" / "default") or a real workspace id. */
export type ActiveWorkspaceId = string;

/**
 * Holds the user-defined workspaces (sidebar tabs) and the active selection.
 * Workspace membership lives on each project (`project.data.workspaceId`); this
 * store only owns the list of workspaces and which tab is active.
 */
export class WorkspaceStore {
  workspaces: Workspace[] = [];
  activeWorkspaceId: ActiveWorkspaceId = ALL_WORKSPACES_ID;

  constructor() {
    makeAutoObservable(this);
  }

  async load(): Promise<void> {
    const list = await rpc.workspaces.listWorkspaces();
    runInAction(() => {
      this.workspaces = list;
      this.normalizeActive();
    });
  }

  /** Keep the active selection valid if its workspace was removed elsewhere. */
  private normalizeActive(): void {
    if (
      this.activeWorkspaceId === ALL_WORKSPACES_ID ||
      this.activeWorkspaceId === DEFAULT_WORKSPACE_ID
    ) {
      return;
    }
    if (!this.workspaces.some((w) => w.id === this.activeWorkspaceId)) {
      this.activeWorkspaceId = ALL_WORKSPACES_ID;
    }
  }

  setActiveWorkspaceId(id: ActiveWorkspaceId): void {
    this.activeWorkspaceId = id;
  }

  get activeWorkspace(): Workspace | undefined {
    return this.workspaces.find((w) => w.id === this.activeWorkspaceId);
  }

  /** True when items should be filtered (anything other than the "All" view). */
  get isFiltering(): boolean {
    return this.activeWorkspaceId !== ALL_WORKSPACES_ID;
  }

  /** Whether an entity assigned to `assignedId` belongs in the active selection. */
  matchesActive(assignedId: string | null | undefined): boolean {
    if (!this.isFiltering) return true;
    const normalized = assignedId ?? null;
    // "Default" = items with no user workspace assigned.
    if (this.activeWorkspaceId === DEFAULT_WORKSPACE_ID) return normalized === null;
    return normalized === this.activeWorkspaceId;
  }

  async createWorkspace(name: string): Promise<Workspace> {
    const created = await rpc.workspaces.createWorkspace(name);
    runInAction(() => {
      this.workspaces = [...this.workspaces, created];
    });
    return created;
  }

  async renameWorkspace(id: string, name: string): Promise<void> {
    await rpc.workspaces.renameWorkspace(id, name);
    runInAction(() => {
      this.workspaces = this.workspaces.map((w) => (w.id === id ? { ...w, name } : w));
    });
  }

  async deleteWorkspace(id: string): Promise<void> {
    await rpc.workspaces.deleteWorkspace(id);
    runInAction(() => {
      this.workspaces = this.workspaces.filter((w) => w.id !== id);
      this.normalizeActive();
    });
  }

  async reorderWorkspaces(orderedIds: string[]): Promise<void> {
    runInAction(() => {
      const byId = new Map(this.workspaces.map((w) => [w.id, w] as const));
      this.workspaces = orderedIds
        .map((id, index) => {
          const w = byId.get(id);
          return w ? { ...w, sortOrder: index } : undefined;
        })
        .filter((w): w is Workspace => w !== undefined);
    });
    await rpc.workspaces.reorderWorkspaces(orderedIds);
  }

  async assignProject(projectId: string, workspaceId: string | null): Promise<void> {
    await rpc.workspaces.assignProjectToWorkspace(projectId, workspaceId);
  }

  async assignTask(taskId: string, workspaceId: string | null): Promise<void> {
    await rpc.workspaces.assignTaskToWorkspace(taskId, workspaceId);
  }

  restoreActiveWorkspaceId(id: string | undefined): void {
    if (id === undefined) return;
    this.activeWorkspaceId = id;
    this.normalizeActive();
  }
}
