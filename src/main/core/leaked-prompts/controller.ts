import { createRPCController } from '@shared/ipc/rpc';
import { leakedPromptsService } from './leaked-prompts-service';

export const leakedPromptsController = createRPCController({
  list: () => leakedPromptsService.list(),
  refresh: () => leakedPromptsService.refresh(),
  getContent: (id: string) => leakedPromptsService.getContent(id),
});
