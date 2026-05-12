import { createRPCController } from '@shared/ipc/rpc';
import { archiveProject } from './operations/archiveProject';
import { createProject, inspectProjectPath } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getArchivedProjects, getProjects } from './operations/getProjects';
import { openProject } from './operations/openProject';
import { unarchiveProject } from './operations/unarchiveProject';
import { updateProjectAlias } from './operations/updateProjectAlias';
import { updateProjectConnection } from './operations/updateProjectConnection';
import {
  getProjectSettingsPage,
  shareProjectSettingsToConfig,
  updateProjectSettings,
} from './settings/project-settings-service';

export const projectController = createRPCController({
  createProject,
  inspectProjectPath,
  getProjects,
  getArchivedProjects,
  deleteProject,
  archiveProject,
  unarchiveProject,
  getProjectSettingsPage,
  updateProjectSettings,
  shareProjectSettingsToConfig,
  updateProjectConnection,
  updateProjectAlias,
  openProject,
});
