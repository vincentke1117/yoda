import { describe, expect, it } from 'vitest';
import { buildTokenHeatmapMonthLabels, buildTokenHeatmapWeeks } from './TokenHeatmap';

describe('TokenHeatmap month labels', () => {
  it('uses the current and previous two calendar months', () => {
    const today = new Date(2026, 5, 30);
    const weeks = buildTokenHeatmapWeeks([], today);

    const labels = buildTokenHeatmapMonthLabels(weeks, 'zh-CN', today.getFullYear()).filter(
      (label): label is string => label !== null
    );

    expect(weeks).toHaveLength(14);
    expect(weeks[0]![0]!.key).toBe('2026-03-30');
    expect(labels).toEqual(['4月', '5月', '6月']);
    expect(labels).not.toContain('3月');
    expect(labels).not.toContain('7月');
  });

  it('includes a short year for previous-year months', () => {
    const today = new Date(2026, 0, 15);
    const weeks = buildTokenHeatmapWeeks([], today);

    const labels = buildTokenHeatmapMonthLabels(weeks, 'zh-CN', today.getFullYear()).filter(
      (label): label is string => label !== null
    );

    expect(labels).toEqual(['25年11月', '25年12月', '1月']);
  });
});
