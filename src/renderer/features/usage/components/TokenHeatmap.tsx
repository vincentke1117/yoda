import { useTranslation } from 'react-i18next';
import type { DailyTokenUsage } from '@shared/stats';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';

const WEEKS = 52;
const DAY_MS = 24 * 60 * 60 * 1000;

// GitHub-familiar green ramp built on the theme's diff-added token so it
// adapts to dark mode. (`accent` maps to a background tint in this theme and
// has no --color-* utility — do not use it for fills.)
const LEVEL_CLASSES = [
  'bg-background-tertiary-2',
  'bg-foreground-diff-added/25',
  'bg-foreground-diff-added/45',
  'bg-foreground-diff-added/70',
  'bg-foreground-diff-added',
] as const;

export type DayCell = {
  key: string;
  total: number;
  inFuture: boolean;
};

/**
 * GitHub-style activity grid of daily token burn over the last year.
 * Pure CSS grid — columns are weeks (Monday-first), month labels appear on
 * the week that contains the 1st. Intensity uses quantiles of non-zero days
 * so one monster day doesn't flatten the rest of the year.
 */
export function TokenHeatmap({ daily }: { daily: DailyTokenUsage[] }) {
  const { t, i18n } = useTranslation();

  const thresholds = quantileThresholds(
    daily.map((day) => day.tokens.total).filter((total) => total > 0)
  );
  const todayStart = startOfLocalDay(new Date());
  const weeks = buildTokenHeatmapWeeks(daily, todayStart);
  const monthLabels = buildTokenHeatmapMonthLabels(weeks, i18n.language, todayStart.getFullYear());

  // Monday-first row labels; show every other row to stay quiet.
  const weekdayFormatter = new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' });
  const gridStart = dateFromLocalDateKey(weeks[0]![0]!.key);
  const weekdayLabels = [1, 3, 5].map((day) =>
    weekdayFormatter.format(new Date(gridStart.getTime() + day * DAY_MS))
  );

  return (
    <div className="flex flex-col gap-1.5 overflow-x-auto">
      <div className="flex gap-[3px] pl-6 text-[9px] leading-none text-foreground-passive">
        {monthLabels.map((label, index) => (
          <span key={index} className="w-2.5 shrink-0 overflow-visible whitespace-nowrap">
            {label ?? ''}
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <div className="flex w-4.5 shrink-0 flex-col justify-between py-0.5 text-[9px] leading-none text-foreground-passive">
          {weekdayLabels.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {weeks.map((cells, weekIndex) => (
            <div key={weekIndex} className="flex shrink-0 flex-col gap-[3px]">
              {cells.map((cell) =>
                cell.inFuture ? (
                  <span key={cell.key} className="size-2.5" />
                ) : (
                  <span
                    key={cell.key}
                    className={cn(
                      'size-2.5 rounded-[2px]',
                      LEVEL_CLASSES[level(cell.total, thresholds)]
                    )}
                    title={
                      cell.total > 0
                        ? t('usage.heatmap.dayTooltip', {
                            date: cell.key,
                            tokens: formatCompactNumber(cell.total),
                          })
                        : t('usage.heatmap.emptyDayTooltip', { date: cell.key })
                    }
                  />
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 self-end text-[9px] leading-none text-foreground-passive">
        {t('usage.heatmap.less')}
        {LEVEL_CLASSES.map((levelClass) => (
          <span key={levelClass} className={cn('size-2.5 rounded-[2px]', levelClass)} />
        ))}
        {t('usage.heatmap.more')}
      </div>
    </div>
  );
}

export function buildTokenHeatmapWeeks(daily: DailyTokenUsage[], today: Date): DayCell[][] {
  const totalsByDate = new Map(daily.map((day) => [day.date, day.tokens.total]));
  const todayStart = startOfLocalDay(today);
  // Back up to the Monday that starts the first of the WEEKS columns.
  const mondayOffset = (todayStart.getDay() + 6) % 7;
  const gridStart = new Date(todayStart.getTime() - (mondayOffset + (WEEKS - 1) * 7) * DAY_MS);

  const weeks: DayCell[][] = [];
  for (let week = 0; week < WEEKS; week++) {
    const cells: DayCell[] = [];
    for (let day = 0; day < 7; day++) {
      const date = new Date(gridStart.getTime() + (week * 7 + day) * DAY_MS);
      const key = localDateKey(date);
      cells.push({
        key,
        total: totalsByDate.get(key) ?? 0,
        inFuture: date.getTime() > todayStart.getTime(),
      });
    }
    weeks.push(cells);
  }
  return weeks;
}

export function buildTokenHeatmapMonthLabels(
  weeks: DayCell[][],
  language: string,
  currentYear: number
): Array<string | null> {
  const monthFormatter = new Intl.DateTimeFormat(language, { month: 'short' });
  const crossYearMonthFormatter = new Intl.DateTimeFormat(language, {
    month: 'short',
    year: '2-digit',
  });

  return weeks.map((cells, index) => {
    const first = dateFromLocalDateKey(cells[0]!.key);
    if (index > 0) {
      const previous = dateFromLocalDateKey(weeks[index - 1]![0]!.key);
      if (
        first.getMonth() === previous.getMonth() &&
        first.getFullYear() === previous.getFullYear()
      ) {
        return null;
      }
    }
    const formatter =
      first.getFullYear() === currentYear ? monthFormatter : crossYearMonthFormatter;
    return formatter.format(first);
  });
}

/** p25 / p50 / p75 of the non-zero days — the boundaries between levels 1-4. */
function quantileThresholds(nonZeroTotals: number[]): [number, number, number] {
  if (nonZeroTotals.length === 0) return [Infinity, Infinity, Infinity];
  const sorted = [...nonZeroTotals].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  return [at(0.25), at(0.5), at(0.75)];
}

function level(total: number, [p25, p50, p75]: [number, number, number]): number {
  if (total <= 0) return 0;
  if (total > p75) return 4;
  if (total > p50) return 3;
  if (total > p25) return 2;
  return 1;
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateFromLocalDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
