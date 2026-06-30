import { describe, expect, it } from 'vitest';
import { buildTokenHeatmapMonthLabels, buildTokenHeatmapWeeks } from './TokenHeatmap';

describe('TokenHeatmap month labels', () => {
  it('includes a short year for previous-year months in the trailing 52-week window', () => {
    const today = new Date(2026, 5, 30);
    const weeks = buildTokenHeatmapWeeks([], today);

    const labels = buildTokenHeatmapMonthLabels(weeks, 'zh-CN', today.getFullYear()).filter(
      (label): label is string => label !== null
    );

    expect(labels.slice(0, 6)).toEqual([
      '25年7月',
      '25年8月',
      '25年9月',
      '25年10月',
      '25年11月',
      '25年12月',
    ]);
    expect(labels).toContain('1月');
    expect(labels).toContain('6月');
    expect(labels).not.toContain('7月');
  });
});
