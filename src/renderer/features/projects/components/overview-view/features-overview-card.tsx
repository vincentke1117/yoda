import { AlertTriangle, ArrowRight, CheckCircle2, Milestone, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openFeature } from '@renderer/features/features/feature-navigation';
import { useFeatures } from '@renderer/features/features/use-features';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';

const RECENT_LIMIT = 3;

export function FeaturesOverviewCard({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data: features = [], isLoading } = useFeatures(projectId);
  const showCreate = useShowModal('createFeatureModal');
  const active = features.filter(
    (feature) => feature.status === 'active' || feature.status === 'blocked'
  );
  const readyCount = active.filter((feature) => feature.gate.canAdvance).length;
  const blockedCount = active.filter((feature) => feature.gate.blockers.length > 0).length;

  const create = () =>
    showCreate({ projectId, onSuccess: (feature) => openFeature(projectId, feature.id) });

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <Milestone className="size-3.5" />
            {t('featureDelivery.title')}
          </h2>
          <span className="font-mono text-[10px] text-foreground-passive">
            {t('featureDelivery.activeCount', { count: active.length })}
          </span>
          {readyCount > 0 ? (
            <Badge className="bg-status-done/10 text-status-done">
              <CheckCircle2 className="size-3" />
              {t('featureDelivery.readyCount', { count: readyCount })}
            </Badge>
          ) : null}
          {blockedCount > 0 ? (
            <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-3" />
              {t('featureDelivery.blockedCount', { count: blockedCount })}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={create}>
            <Plus className="size-3.5" />
            {t('featureDelivery.newFeature')}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('projects.viewAll')}
            onClick={() => openFeature(projectId)}
          >
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </header>
      {isLoading ? (
        <p className="text-xs text-foreground-muted">{t('common.loading')}</p>
      ) : active.length === 0 ? (
        <button
          type="button"
          className="w-full rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-foreground-passive transition-colors hover:bg-background-1"
          onClick={create}
        >
          {t('featureDelivery.emptyCompact')}
        </button>
      ) : (
        <ul className="space-y-1">
          {active.slice(0, RECENT_LIMIT).map((feature) => (
            <li key={feature.id}>
              <button
                type="button"
                className="group flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-background-hover"
                onClick={() => openFeature(projectId, feature.id)}
              >
                <span
                  className={
                    feature.gate.canAdvance
                      ? 'size-1.5 shrink-0 rounded-full bg-status-done'
                      : 'size-1.5 shrink-0 rounded-full bg-amber-500'
                  }
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {feature.title}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-foreground-passive">
                  {t(`featureDelivery.stages.${feature.stage}.short`)}
                </span>
                <RelativeTime
                  value={feature.updatedAt}
                  compact
                  className="w-14 shrink-0 text-right text-[10px] text-foreground-passive"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
