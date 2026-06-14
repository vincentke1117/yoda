import { createRPCController } from '@shared/ipc/rpc';
import { reviewOrchestrator, type StartReviewOrchestrationParams } from './orchestrator';

export const reviewOrchestrationController = createRPCController({
  start: (params: StartReviewOrchestrationParams): Promise<string> =>
    reviewOrchestrator.start(params),
  abort: (id: string): void => reviewOrchestrator.abort(id),
});
