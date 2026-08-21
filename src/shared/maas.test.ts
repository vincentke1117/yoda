import { describe, expect, it } from 'vitest';
import {
  hasMaasInferenceCredential,
  resolveMaasEnvKey,
  resolveModelNamespace,
  resolveSecretKind,
  type MaasConnection,
} from './maas';

describe('resolveMaasEnvKey', () => {
  it('keeps the conventional key for the default Profile name', () => {
    expect(resolveMaasEnvKey('zenmux', 'ZenMux')).toBe('ZENMUX_API_KEY');
  });

  it('derives a distinct key when another Profile uses a different name', () => {
    expect(resolveMaasEnvKey('zenmux:secondary', 'ZenMux 2')).toBe('ZENMUX_2_API_KEY');
  });

  it('preserves an explicitly customized environment key', () => {
    expect(resolveMaasEnvKey('zenmux:secondary', 'ZenMux 2', 'TEAM_ZENMUX_KEY')).toBe(
      'TEAM_ZENMUX_KEY'
    );
  });
});

describe('resolveSecretKind', () => {
  it('uses the separate inference slot for platforms that declare it', () => {
    expect(resolveSecretKind('zenmux')).toBe('inference');
    expect(resolveSecretKind('profile:zenmux:abc')).toBe('inference');
  });

  it('uses the primary slot for other platforms', () => {
    expect(resolveSecretKind('openrouter')).toBe('primary');
    expect(resolveSecretKind('cliproxyapi')).toBe('primary');
    expect(resolveSecretKind('custom')).toBe('primary');
    expect(resolveSecretKind('profile:newapi:abc')).toBe('primary');
  });
});

describe('hasMaasInferenceCredential', () => {
  const baseConnection: MaasConnection = {
    platformId: 'openrouter',
    displayName: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    keyFingerprint: null,
    inferenceKeyFingerprint: null,
    connectedAt: null,
    lastCheckedAt: null,
    lastTest: null,
    configured: true,
    connected: false,
    error: null,
  };

  it('reads the inference fingerprint for platforms with a separate inference key', () => {
    expect(
      hasMaasInferenceCredential({
        ...baseConnection,
        platformId: 'zenmux',
        inferenceKeyFingerprint: 'fp',
      })
    ).toBe(true);
    expect(
      hasMaasInferenceCredential({
        ...baseConnection,
        platformId: 'zenmux',
        keyFingerprint: 'fp',
      })
    ).toBe(false);
  });

  it('reads the primary fingerprint for other platforms', () => {
    expect(hasMaasInferenceCredential({ ...baseConnection, keyFingerprint: 'fp' })).toBe(true);
  });
});

describe('resolveModelNamespace', () => {
  it('returns prefixed for platforms that declare it', () => {
    expect(resolveModelNamespace('zenmux')).toBe('prefixed');
  });

  it('recognizes a profile connection by hostname even when the template is custom', () => {
    expect(resolveModelNamespace('profile:new-zenmux', 'https://zenmux.ai/api/v1')).toBe(
      'prefixed'
    );
    expect(resolveModelNamespace('profile:direct-openai', 'https://api.openai.com/v1')).toBe(
      'native'
    );
  });

  it('defaults to native for unknown platforms without a matching hostname', () => {
    expect(resolveModelNamespace('cliproxyapi', 'http://127.0.0.1:8317/v1')).toBe('native');
    expect(resolveModelNamespace('custom')).toBe('native');
  });
});
