import { AlertTriangle, FileCheck2, ListChecks, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FeatureSummary } from '@shared/features';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';

export function FeatureList({
  features,
  selectedId,
  onSelect,
  onCreate,
}: {
  features: FeatureSummary[];
  selectedId?: string;
  onSelect: (featureId: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();

  return (
    <aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-border bg-background-secondary @max-[760px]:h-40 @max-[760px]:w-full @max-[760px]:border-r-0 @max-[760px]:border-b">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div>
          <div className="text-xs font-medium text-foreground">
            {t('featureDelivery.listLabel')}
          </div>
          <div className="font-mono text-[10px] text-foreground-passive">
            {t('featureDelivery.featureCount', { count: features.length })}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('featureDelivery.newFeature')}
          onClick={onCreate}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 @max-[760px]:flex @max-[760px]:gap-1 @max-[760px]:overflow-x-auto">
        {features.map((feature) => (
          <button
            key={feature.id}
            type="button"
            className={cn(
              'group relative mb-1 flex w-full flex-col gap-2 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-background-1 @max-[760px]:mb-0 @max-[760px]:w-52 @max-[760px]:min-w-52 @max-[760px]:shrink-0',
              selectedId === feature.id &&
                'bg-background shadow-xs ring-1 ring-inset ring-border-primary/60'
            )}
            onClick={() => onSelect(feature.id)}
          >
            {selectedId === feature.id ? (
              <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary" />
            ) : null}
            <span className="line-clamp-2 text-xs font-medium leading-5 text-foreground">
              {feature.title}
            </span>
            <span className="flex min-w-0 items-center justify-between gap-2 text-[10px] text-foreground-passive">
              <span className="min-w-0 truncate font-mono uppercase tracking-[0.08em]">
                {t(`featureDelivery.stages.${feature.stage}.short`)}
              </span>
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full bg-status-in-progress',
                  feature.status === 'blocked' && 'bg-amber-500',
                  feature.status === 'completed' && 'bg-status-done',
                  feature.status === 'cancelled' && 'bg-foreground-passive'
                )}
                title={t(`featureDelivery.statuses.${feature.status}`)}
              />
            </span>
            <span className="flex items-center gap-2 text-[10px] text-foreground-passive">
              <span className="inline-flex items-center gap-1">
                <ListChecks className="size-3" /> {feature.taskCount}
              </span>
              <span className="inline-flex items-center gap-1">
                <FileCheck2 className="size-3" /> {feature.artifactCount}
              </span>
              {feature.gate.blockers.length > 0 ? (
                <span className="ml-auto inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3" /> {feature.gate.blockers.length}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
