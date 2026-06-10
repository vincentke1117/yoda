import type { RuntimeCustomConfig } from '@shared/app-settings';
import { OverrideSettings } from './override-settings';
import { runtimeConfigDefaults, runtimeCustomConfigEntrySchema } from './schema';

export const runtimeOverrideSettings = new OverrideSettings<RuntimeCustomConfig>(
  'runtimeConfigs',
  () => runtimeConfigDefaults as Record<string, RuntimeCustomConfig>,
  runtimeCustomConfigEntrySchema
);
