import { createRPCController } from '@shared/ipc/rpc';
import { lovcodeService } from './lovcode-service';

export const lovcodeController = createRPCController({
  checkAvailability: () => lovcodeService.checkAvailability(true),
  search: (projectId: string, projectPath: string, query: string) =>
    lovcodeService.search(projectId, projectPath, query),
});
