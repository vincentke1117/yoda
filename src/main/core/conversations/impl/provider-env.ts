import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV = 'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN';

export function resolveProviderEnv(
  providerConfig: ProviderCustomConfig | undefined,
  options: { providerId?: AgentProviderId; tmuxEnabled?: boolean } = {}
): Record<string, string> | undefined {
  const env: Record<string, string> = {};

  if (providerConfig?.env) {
    for (const [key, value] of Object.entries(providerConfig.env)) {
      if (ENV_NAME_PATTERN.test(key)) env[key] = value;
    }
  }

  if (
    options.providerId === 'claude' &&
    options.tmuxEnabled === true &&
    env[CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV] === undefined
  ) {
    env[CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV] = '1';
  }

  return Object.keys(env).length > 0 ? env : undefined;
}

export function resolveProviderTmuxEnv(
  providerEnv: Record<string, string> | undefined
): Record<string, string> | undefined {
  const claudeAlternateScreenOverride = providerEnv?.[CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV];
  if (claudeAlternateScreenOverride === undefined) return undefined;
  return {
    [CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV]: claudeAlternateScreenOverride,
  };
}
