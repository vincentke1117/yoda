import type { AutomationCreateInput, AutomationUpdateInput } from '@shared/automation';
import { createRPCController } from '@shared/ipc/rpc';
import { automationService } from './automation-service';

export const automationController = createRPCController({
  list: () => automationService.list(),
  create: (input: AutomationCreateInput) => automationService.create(input),
  update: (id: string, patch: AutomationUpdateInput) => automationService.update(id, patch),
  delete: (id: string) => automationService.remove(id),
});
