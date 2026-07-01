export const DEFAULT_ROUTING_HOP_LIMIT = 100;

export type RoutingHopLimit = number | null;

export function normalizeRoutingHopLimit(value: unknown): RoutingHopLimit {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ROUTING_HOP_LIMIT;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : DEFAULT_ROUTING_HOP_LIMIT;
}
