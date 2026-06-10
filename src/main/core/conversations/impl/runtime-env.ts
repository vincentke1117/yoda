import type { RuntimeCustomConfig } from '@shared/app-settings';
import { getRuntimeAccountProfile, type RuntimeId } from '@shared/runtime-registry';

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV = 'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN';

function shouldForwardOfficialApiEnv(providerConfig: RuntimeCustomConfig | undefined): boolean {
  return !providerConfig?.authProvider || providerConfig.authProvider === 'official-api';
}

function officialApiEnvVarsForProvider(runtimeId: RuntimeId | undefined): Set<string> {
  if (!runtimeId) return new Set();
  return new Set(getRuntimeAccountProfile(runtimeId).officialApi.envVars);
}

export function resolveAgentApiEnvVars(
  providerConfig: RuntimeCustomConfig | undefined,
  runtimeId: RuntimeId
): false | readonly string[] {
  if (!shouldForwardOfficialApiEnv(providerConfig)) return false;
  return getRuntimeAccountProfile(runtimeId).officialApi.envVars;
}

export function resolveRuntimeBaseEnv(
  baseEnv: NodeJS.ProcessEnv,
  providerConfig: RuntimeCustomConfig | undefined,
  runtimeId: RuntimeId
): NodeJS.ProcessEnv {
  if (shouldForwardOfficialApiEnv(providerConfig)) return baseEnv;

  const env = { ...baseEnv };
  for (const key of officialApiEnvVarsForProvider(runtimeId)) {
    delete env[key];
  }
  return env;
}

export function resolveRuntimeEnv(
  providerConfig: RuntimeCustomConfig | undefined,
  options: { runtimeId?: RuntimeId; tmuxEnabled?: boolean } = {}
): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  const officialApiEnvVars = officialApiEnvVarsForProvider(options.runtimeId);
  const forwardOfficialApiEnv = shouldForwardOfficialApiEnv(providerConfig);

  if (providerConfig?.env) {
    for (const [key, value] of Object.entries(providerConfig.env)) {
      if (!forwardOfficialApiEnv && officialApiEnvVars.has(key)) continue;
      if (ENV_NAME_PATTERN.test(key)) env[key] = value;
    }
  }

  if (
    options.runtimeId === 'claude' &&
    options.tmuxEnabled === true &&
    env[CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV] === undefined
  ) {
    env[CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV] = '1';
  }

  return Object.keys(env).length > 0 ? env : undefined;
}

export function resolveRuntimeTmuxEnv(
  providerEnv: Record<string, string> | undefined
): Record<string, string> | undefined {
  const claudeAlternateScreenOverride = providerEnv?.[CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV];
  if (claudeAlternateScreenOverride === undefined) return undefined;
  return {
    [CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV]: claudeAlternateScreenOverride,
  };
}
