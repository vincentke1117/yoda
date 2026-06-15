import { createRPCController } from '@shared/ipc/rpc';
import type { PromptCreateInput, PromptUpdateInput } from '@shared/prompt-library';
import { promptLibraryService } from './prompt-library-service';

export const promptLibraryController = createRPCController({
  list: () => promptLibraryService.list(),
  create: (input: PromptCreateInput) => promptLibraryService.create(input),
  update: (id: string, patch: PromptUpdateInput) => promptLibraryService.update(id, patch),
  delete: (id: string) => promptLibraryService.remove(id),
});
