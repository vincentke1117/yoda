import { createRPCController } from '@shared/ipc/rpc';
import { feedbackService, type SubmitFeedbackInput } from './feedback-service';

export const feedbackController = createRPCController({
  submit: async (input: SubmitFeedbackInput) => feedbackService.submit(input),
});
