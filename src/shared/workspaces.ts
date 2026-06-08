export type Workspace = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** Virtual selection id for "All" — every project/task regardless of workspace. */
export const ALL_WORKSPACES_ID = 'all';

/**
 * Virtual selection id for the "Default" workspace — items not assigned to any
 * user workspace (workspaceId == null). Not a persisted row.
 */
export const DEFAULT_WORKSPACE_ID = 'default';

export const MAX_WORKSPACE_NAME_LENGTH = 60;
