import type { AiLogListInput } from '@shared/ai-logs';
import { createRPCController } from '@shared/ipc/rpc';
import { aiLogService } from './ai-log-service';

async function list(input?: AiLogListInput) {
  return aiLogService.list(input ?? {});
}

async function clear() {
  return aiLogService.clear();
}

export const aiLogsController = createRPCController({
  list,
  clear,
});
