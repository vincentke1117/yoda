import { CheckCircle2, ChevronRight, Trash2, XCircle } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiInvocationLogRecord, AiLogStatus } from '@shared/ai-logs';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { useAiLogs, useClearAiLogs } from '../use-ai-logs';

type StatusFilter = AiLogStatus | 'all';

const STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'succeeded', 'failed'];

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export const AiLogsPanel: React.FC = () => {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const { data: logs, isLoading } = useAiLogs(
    statusFilter === 'all' ? {} : { status: statusFilter }
  );
  const clearLogs = useClearAiLogs();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          multiple={false}
          value={[statusFilter]}
          onValueChange={([value]) => {
            if (value) setStatusFilter(value as StatusFilter);
          }}
        >
          {STATUS_FILTERS.map((filter) => (
            <ToggleGroupItem key={filter} value={filter} className="text-xs">
              {t(`aiLogs.filter.${filter}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={clearLogs.isPending || (logs?.length ?? 0) === 0}
          onClick={() => clearLogs.mutate()}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('aiLogs.clear')}
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-10">
          <Spinner className="h-5 w-5" />
        </div>
      )}

      {!isLoading && (logs?.length ?? 0) === 0 && (
        <EmptyState label={t('aiLogs.emptyTitle')} description={t('aiLogs.emptyDescription')} />
      )}

      <div className="flex flex-col gap-1.5">
        {logs?.map((record) => (
          <LogRow key={record.id} record={record} />
        ))}
      </div>
    </div>
  );
};

const StatusIcon: React.FC<{ status: AiLogStatus }> = ({ status }) => {
  if (status === 'running') return <Spinner className="h-3.5 w-3.5 shrink-0" />;
  if (status === 'succeeded')
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
};

const LogRow: React.FC<{ record: AiInvocationLogRecord }> = ({ record }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const purposeLabel = t(`aiLogs.purpose.${record.purpose}`, { defaultValue: record.purpose });

  return (
    <div className="rounded-lg border border-border bg-background-secondary">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90'
          )}
        />
        <StatusIcon status={record.status} />
        <span className="shrink-0 text-sm font-medium">{purposeLabel}</span>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {t(`aiLogs.mode.${record.mode}`)}
        </Badge>
        <Badge variant="outline" className="min-w-0 max-w-40 truncate text-[10px]">
          {record.model ? `${record.runtime} · ${record.model}` : record.runtime}
        </Badge>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {record.status === 'running' ? (
            <span>
              {t('aiLogs.runningSince')} <RelativeTime value={record.startedAt} ago />
            </span>
          ) : (
            <>
              {record.durationMs !== null && <span>{formatDuration(record.durationMs)}</span>}
              <RelativeTime value={record.startedAt} ago />
            </>
          )}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3 text-xs">
          <DetailGrid record={record} />
          {record.error && (
            <DetailBlock label={t('aiLogs.error')} value={record.error} destructive />
          )}
          {record.command && (
            <DetailBlock label={t('aiLogs.command')} value={record.command} mono />
          )}
          {record.prompt && <DetailBlock label={t('aiLogs.prompt')} value={record.prompt} />}
          {record.output && <DetailBlock label={t('aiLogs.output')} value={record.output} />}
        </div>
      )}
    </div>
  );
};

const DetailGrid: React.FC<{ record: AiInvocationLogRecord }> = ({ record }) => {
  const { t } = useTranslation();
  const entries: Array<[string, string]> = [
    [t('aiLogs.started'), formatTimestamp(record.startedAt)],
    ...(record.finishedAt
      ? ([[t('aiLogs.finished'), formatTimestamp(record.finishedAt)]] as Array<[string, string]>)
      : []),
    ...(record.durationMs !== null
      ? ([[t('aiLogs.duration'), formatDuration(record.durationMs)]] as Array<[string, string]>)
      : []),
    ...Object.entries(record.metadata ?? {}),
  ];
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
      {entries.map(([label, value]) => (
        <React.Fragment key={label}>
          <span className="text-muted-foreground">{label}</span>
          <span className="break-all">{value}</span>
        </React.Fragment>
      ))}
    </div>
  );
};

const DetailBlock: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  destructive?: boolean;
}> = ({ label, value, mono, destructive }) => (
  <div className="flex flex-col gap-1">
    <span className="text-muted-foreground">{label}</span>
    <pre
      className={cn(
        'max-h-56 overflow-y-auto rounded-md border border-border bg-background px-2.5 py-2 whitespace-pre-wrap break-all',
        mono ? 'font-mono' : 'font-sans',
        destructive && 'border-destructive/20 bg-destructive/10 text-destructive'
      )}
    >
      {value}
    </pre>
  </div>
);
