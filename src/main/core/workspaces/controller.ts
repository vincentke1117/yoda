import { createRPCController } from '@shared/ipc/rpc';
import {
  assignProjectToWorkspace,
  assignTaskToWorkspace,
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  renameWorkspace,
  reorderWorkspaces,
} from './operations';

export const workspaceController = createRPCController({
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
  reorderWorkspaces,
  assignProjectToWorkspace,
  assignTaskToWorkspace,
});
