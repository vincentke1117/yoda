import { defineEvent } from '@shared/ipc/events';

export type AiLabBuildEventTarget = {
  projectId: string;
  taskId: string;
  conversationId: string;
};

export const aiLabAppCreatedChannel = defineEvent<
  AiLabBuildEventTarget & { appId: string; appName: string }
>('ai-lab:app-created');

export const aiLabAppUpdatedChannel = defineEvent<{ appId: string; appName: string }>(
  'ai-lab:app-updated'
);

export const aiLabBuildFailedChannel = defineEvent<AiLabBuildEventTarget & { message: string }>(
  'ai-lab:build-failed'
);
