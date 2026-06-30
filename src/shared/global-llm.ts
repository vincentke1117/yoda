export const GLOBAL_LLM_PROVIDER_IDS = ['maas', 'agent'] as const;

export type GlobalLlmProvider = (typeof GLOBAL_LLM_PROVIDER_IDS)[number];
export type GlobalLlmDebugProvider = GlobalLlmProvider | 'auto';

export type GlobalLlmSettingsShape = {
  maasEnabled: boolean;
  maasModel: string;
  agentEnabled: boolean;
  agentId: string;
  preferredProvider: GlobalLlmProvider;
  promptTranslationEnabled: boolean;
  promptTranslationShowOriginal: boolean;
};

export type GlobalLlmDebugInput = {
  prompt: string;
  provider?: GlobalLlmDebugProvider;
};

export type GlobalLlmDebugResult = {
  success: boolean;
  provider: GlobalLlmProvider | null;
  model: string | null;
  output: string;
  durationMs: number;
  error?: string;
};

export function getGlobalLlmRouteOrder(settings: GlobalLlmSettingsShape): GlobalLlmProvider[] {
  const providers: GlobalLlmProvider[] =
    settings.preferredProvider === 'agent' ? ['agent', 'maas'] : ['maas', 'agent'];
  return providers.filter((provider) =>
    provider === 'maas' ? settings.maasEnabled : settings.agentEnabled
  );
}
