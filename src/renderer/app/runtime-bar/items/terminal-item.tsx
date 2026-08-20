import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Globe, Square, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { globalBackendDevServers } from '@renderer/app/runtime-bar/backend-dev-servers';
import {
  WORKSPACE_BAR_ACTION_COUNT_CLASS,
  WorkspaceBarActionGlyph,
} from '@renderer/app/workspace-bar-action-indicator';
import {
  WORKSPACE_BAR_CARD_CLASS,
  WorkspaceBarCardFooter,
  WorkspaceBarCardHeader,
  WorkspaceBarCardSection,
} from '@renderer/app/workspace-bar-card';
import { WORKSPACE_RESOURCE_QUERY_KEY } from '@renderer/app/workspace-resource-monitoring';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { RUNTIME_BAR_ACTION_CLASS, RUNTIME_BAR_ACTION_LABEL_CLASS } from '../bar-chrome';
import { useWorkspaceResourceSnapshot } from '../resource-snapshot';
import { useRuntimeBarSession } from '../session-context';

/**
 * The runtime-bar Terminal entry. Clicking opens a card that both opens the
 * project/global Terminal panel and lists every backend process the user
 * started inside Yoda (quick-action dev servers, AI Lab App previews, Expo
 * Metro) — one glance at the trigger's count answers "is something running?".
 */
export const RuntimeBarTerminalItem = observer(function RuntimeBarTerminalItem() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const { provisionedTask, activeMountedProjectData } = useRuntimeBarSession();
  const { data: resourceSnapshot, refetch: refreshResourceSnapshot } =
    useWorkspaceResourceSnapshot();
  const devServers = globalBackendDevServers.list;
  const backendProcesses = resourceSnapshot?.backendProcesses ?? [];
  const processCount = backendProcesses.length + devServers.length;

  const taskTerminalVisible = Boolean(
    provisionedTask?.taskView.isTerminalDrawerOpen &&
      provisionedTask.taskView.activeBottomPanelTab === 'terminals'
  );
  const workspaceTerminalOpen = workspaceTerminalStore.isOpen;

  useEffect(() => {
    if (isOpen) void refreshResourceSnapshot();
  }, [isOpen, refreshResourceSnapshot]);

  useLayoutEffect(() => {
    // A task drawer can already be open behind the project Terminal. Collapse
    // it before paint so closing the quick-action Terminal cannot reveal an
    // unrelated task Terminal and look like the same button changed sessions.
    if (!isOpen || !workspaceTerminalOpen || !taskTerminalVisible || !provisionedTask) return;
    provisionedTask.taskView.setTerminalDrawerOpen(false);
  }, [isOpen, provisionedTask, taskTerminalVisible, workspaceTerminalOpen]);

  const openTerminalPanel = () => {
    setIsOpen(false);
    void workspaceTerminalStore.toggleForRuntimeBar(activeMountedProjectData).catch(() => {});
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: WORKSPACE_RESOURCE_QUERY_KEY });
  };

  const stopAppPreview = async (id: string) => {
    try {
      await rpc.aiLab.stopAppPreview(id);
      refresh();
    } catch {
      toast.error(t('workspaceRuntime.terminalPopup.stopFailed'));
    }
  };

  const stopMetro = async () => {
    try {
      await rpc.mobileGateway.stopMetro();
      refresh();
    } catch {
      toast.error(t('workspaceRuntime.terminalPopup.stopFailed'));
    }
  };

  const stopDevServer = async (terminalId: string) => {
    try {
      await workspaceTerminalStore.stopTerminal(terminalId);
      refresh();
    } catch {
      toast.error(t('workspaceRuntime.terminalPopup.stopFailed'));
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        aria-label={t('workspaceRuntime.terminal')}
        className={cn(
          RUNTIME_BAR_ACTION_CLASS,
          processCount > 0 ? 'text-foreground' : 'text-foreground-passive'
        )}
        title={t('workspaceRuntime.terminal')}
      >
        <WorkspaceBarActionGlyph icon={Terminal}>
          {processCount > 0 ? (
            <span
              className={cn(WORKSPACE_BAR_ACTION_COUNT_CLASS, 'text-primary')}
              aria-label={t('workspaceRuntime.terminalPopup.triggerLabel', { count: processCount })}
            >
              {processCount}
            </span>
          ) : null}
        </WorkspaceBarActionGlyph>
        <span className={RUNTIME_BAR_ACTION_LABEL_CLASS}>{t('workspaceRuntime.terminal')}</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className={cn(WORKSPACE_BAR_CARD_CLASS, 'w-[400px]')}
      >
        <WorkspaceBarCardHeader
          icon={Terminal}
          title={t('workspaceRuntime.terminalPopup.title')}
          description={t('workspaceRuntime.terminalPopup.description')}
        />
        <WorkspaceBarCardSection label={t('workspaceRuntime.terminalPopup.panel')}>
          <button
            type="button"
            onClick={openTerminalPanel}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-background-2 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Terminal aria-hidden className="size-3.5 shrink-0 text-foreground-muted" />
            <span className="truncate text-sm text-foreground">
              {t('workspaceRuntime.terminalPopup.openPanel')}
            </span>
          </button>
        </WorkspaceBarCardSection>
        <WorkspaceBarCardSection label={t('workspaceRuntime.terminalPopup.processes')}>
          {processCount === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-foreground-passive">
              {t('workspaceRuntime.terminalPopup.processesEmpty')}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {backendProcesses.map((process) => (
                <div
                  key={`${process.kind}:${process.id}`}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5"
                >
                  <Globe aria-hidden className="size-3.5 shrink-0 text-foreground-muted" />
                  <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-2 gap-y-0.5">
                    <span
                      className="truncate text-sm leading-5 text-foreground"
                      title={process.label}
                    >
                      {process.label}
                    </span>
                    <span className="inline-flex h-4 shrink-0 items-center rounded-sm bg-background-2 px-1 font-mono text-[10px] tabular-nums text-foreground-muted">
                      {process.kind === 'metro'
                        ? t('workspaceRuntime.terminalPopup.metro')
                        : t('workspaceRuntime.terminalPopup.appPreview')}
                    </span>
                    <span className="col-span-2 flex min-w-0 items-center gap-1.5 text-[10px] leading-4 text-foreground-passive">
                      {process.projectName ? (
                        <span className="min-w-0 flex-1 truncate">{process.projectName}</span>
                      ) : null}
                      {process.pid != null ? (
                        <span className="shrink-0 font-mono tabular-nums">PID {process.pid}</span>
                      ) : null}
                      {process.detachable ? (
                        <span className="shrink-0 text-primary">
                          {t('workspaceRuntime.terminalPopup.detachable')}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {process.url ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => void rpc.app.openExternal(process.url!)}
                    >
                      <ExternalLink className="size-3" aria-hidden />
                      {t('workspaceRuntime.terminalPopup.openUrl')}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() =>
                      process.kind === 'metro' ? void stopMetro() : void stopAppPreview(process.id)
                    }
                  >
                    <Square className="size-3" aria-hidden />
                    {t('workspaceRuntime.terminalPopup.stop')}
                  </Button>
                </div>
              ))}
              {devServers.map((server) => (
                <div
                  key={`dev-server:${server.taskId}:${server.terminalId}`}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5"
                >
                  <Globe aria-hidden className="size-3.5 shrink-0 text-foreground-muted" />
                  <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm leading-5 text-foreground">
                      {workspaceTerminalStore.findTerminalName(server.terminalId) ??
                        t('workspaceRuntime.terminalPopup.unknownTerminal', {
                          id: server.terminalId.slice(0, 8),
                        })}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-foreground-passive">
                      {server.url.replace(/^https?:\/\//, '')}
                    </span>
                    <span className="col-span-2 truncate text-[10px] leading-4 text-foreground-passive">
                      {server.url}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void rpc.app.openExternal(server.url)}
                  >
                    <ExternalLink className="size-3" aria-hidden />
                    {t('workspaceRuntime.terminalPopup.openUrl')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void stopDevServer(server.terminalId)}
                  >
                    <Square className="size-3" aria-hidden />
                    {t('workspaceRuntime.terminalPopup.stop')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </WorkspaceBarCardSection>
        <WorkspaceBarCardFooter>
          <p className="text-[11px] leading-4 text-foreground-passive">
            {t('workspaceRuntime.terminalPopup.footer')}
          </p>
        </WorkspaceBarCardFooter>
      </PopoverContent>
    </Popover>
  );
});
