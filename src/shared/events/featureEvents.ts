import { defineEvent } from '@shared/ipc/events';

/** Main → renderer invalidation after any Feature aggregate mutation. */
export const featureUpdatedChannel = defineEvent<{
  projectId: string;
  featureId: string;
}>('feature:updated');
