import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING_HOP_LIMIT, normalizeRoutingHopLimit } from './team-routing-limit';

describe('normalizeRoutingHopLimit', () => {
  it('keeps null as unlimited', () => {
    expect(normalizeRoutingHopLimit(null)).toBeNull();
  });

  it('keeps positive finite numbers as integer hop limits', () => {
    expect(normalizeRoutingHopLimit(25)).toBe(25);
    expect(normalizeRoutingHopLimit(25.8)).toBe(25);
  });

  it('falls back to the default for invalid limits', () => {
    expect(normalizeRoutingHopLimit(undefined)).toBe(DEFAULT_ROUTING_HOP_LIMIT);
    expect(normalizeRoutingHopLimit(0)).toBe(DEFAULT_ROUTING_HOP_LIMIT);
    expect(normalizeRoutingHopLimit(-1)).toBe(DEFAULT_ROUTING_HOP_LIMIT);
    expect(normalizeRoutingHopLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_ROUTING_HOP_LIMIT);
  });
});
