import { describe, expect, it } from 'vitest';
import { getGlobalLlmRouteOrder, type GlobalLlmSettingsShape } from './global-llm';

describe('getGlobalLlmRouteOrder', () => {
  it('orders MaaS first when both routes are enabled and MaaS is preferred', () => {
    expect(getGlobalLlmRouteOrder(settings({ preferredProvider: 'maas' }))).toEqual([
      'maas',
      'agent',
    ]);
  });

  it('orders Agent first when both routes are enabled and Agent is preferred', () => {
    expect(getGlobalLlmRouteOrder(settings({ preferredProvider: 'agent' }))).toEqual([
      'agent',
      'maas',
    ]);
  });

  it('keeps only enabled routes', () => {
    expect(getGlobalLlmRouteOrder(settings({ maasEnabled: false }))).toEqual(['agent']);
    expect(getGlobalLlmRouteOrder(settings({ agentEnabled: false }))).toEqual(['maas']);
    expect(getGlobalLlmRouteOrder(settings({ maasEnabled: false, agentEnabled: false }))).toEqual(
      []
    );
  });
});

function settings(overrides: Partial<GlobalLlmSettingsShape> = {}): GlobalLlmSettingsShape {
  return {
    maasEnabled: true,
    maasModel: '',
    agentEnabled: true,
    agentId: '',
    preferredProvider: 'maas',
    promptTranslationEnabled: false,
    promptTranslationShowOriginal: true,
    ...overrides,
  };
}
