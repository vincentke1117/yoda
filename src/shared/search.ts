export type SearchItemKind = 'task' | 'project' | 'conversation';

export interface SearchItem {
  kind: SearchItemKind;
  id: string;
  projectId: string | null;
  taskId: string | null;
  title: string;
  subtitle: string;
  score: number;
  /** True for archived tasks — surfaced in search but visually de-emphasised. */
  archived?: boolean;
  /** ISO timestamp of last activity (task/conversation) or last update (project). */
  timestamp?: string | null;
}

export interface CommandPaletteQuery {
  query: string;
  context?: {
    projectId?: string;
    taskId?: string;
    /**
     * Restricts task results to a sidebar workspace (`in:workspace`). A real
     * workspace id, or DEFAULT_WORKSPACE_ID for tasks with no workspace assigned.
     */
    workspaceId?: string;
  };
}

/** Paginated single-kind query for a scoped (infinite-scroll) palette view. */
export interface CommandPalettePagedQuery {
  query: string;
  kind: SearchItemKind;
  offset: number;
  limit: number;
  context?: {
    projectId?: string;
    taskId?: string;
    /** See CommandPaletteQuery.context.workspaceId. */
    workspaceId?: string;
  };
}

export interface CommandPalettePage {
  items: SearchItem[];
  /** Offset to pass for the next page, or null when there are no more items. */
  nextOffset: number | null;
}
