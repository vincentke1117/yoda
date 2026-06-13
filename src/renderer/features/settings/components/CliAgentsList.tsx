import { RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DependencyState } from '@shared/dependencies';
import { isValidRuntimeId, RUNTIMES, type RuntimeId } from '@shared/runtime-registry';
import { type CliAgentStatus } from '@renderer/features/settings/components/connections';
import CustomCommandModal from '@renderer/features/settings/components/CustomCommandModal';
import IntegrationRow from '@renderer/features/settings/components/IntegrationRow';
import { getAgentInstallErrorMessage } from '@renderer/lib/components/agent-selector/agent-install';
import { AgentInstallButton } from '@renderer/lib/components/agent-selector/agent-install-button';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { agentMeta } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';

/**
 * Re-runs detection for all CLI agents. Surfaced in the settings section header
 * so a user who just installed a tool — or whose PATH wasn't ready at boot —
 * can refresh without restarting the app.
 */
export const CliAgentsRescanButton: React.FC = observer(() => {
  const { t } = useTranslation();
  const [rescanning, setRescanning] = useState(false);

  const handleRescan = useCallback(async () => {
    if (rescanning) return;
    setRescanning(true);
    try {
      await appState.dependencies.probeAll();
    } catch (error) {
      log.error('Failed to rescan CLI agents:', error);
    } finally {
      setRescanning(false);
    }
  }, [rescanning]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void handleRescan()}
      disabled={rescanning}
      className="gap-1.5"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${rescanning ? 'animate-spin' : ''}`} />
      {t('settings.agentsTab.rescan')}
    </Button>
  );
});

export const BASE_CLI_AGENTS: CliAgentStatus[] = RUNTIMES.filter(
  (provider) => provider.detectable !== false
).map((provider) => ({
  id: provider.id,
  name: provider.name,
  status: 'missing' as const,
  docUrl: provider.docUrl ?? null,
  installCommand: provider.installCommand ?? null,
}));

function mapDependencyStatesToCli(
  agentStatuses: Record<string, DependencyState>
): CliAgentStatus[] {
  const mergedMap = new Map<string, CliAgentStatus>();
  BASE_CLI_AGENTS.forEach((agent) => {
    mergedMap.set(agent.id, { ...agent });
  });
  Object.entries(agentStatuses).forEach(([agentId, state]) => {
    const base = mergedMap.get(agentId);
    mergedMap.set(agentId, {
      ...(base ?? { id: agentId, name: agentId, docUrl: null, installCommand: null }),
      id: agentId,
      name: base?.name ?? agentId,
      status: state.status === 'available' ? 'connected' : state.status,
      version: state.version ?? null,
      command: state.path ?? null,
    });
  });
  return Array.from(mergedMap.values());
}

const ICON_BUTTON =
  'rounded-md p-1.5 text-muted-foreground transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

type AgentRowActions = {
  isInstalling: (id: RuntimeId) => boolean;
  onInstallClick: (agent: CliAgentStatus) => void;
  onSettingsClick: (id: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
};

const renderAgentRow = (agent: CliAgentStatus, actions: AgentRowActions) => {
  const { t } = actions;
  const logo = agentMeta[agent.id as keyof typeof agentMeta]?.icon;
  const runtimeId = isValidRuntimeId(agent.id) ? agent.id : null;

  const handleNameClick = agent.docUrl
    ? async () => {
        try {
          await rpc.app.openExternal(agent.docUrl!);
        } catch (openError) {
          log.error(`Failed to open ${agent.name} docs:`, openError);
        }
      }
    : undefined;

  const isDetected = agent.status === 'connected';
  const indicatorClass = isDetected ? 'bg-emerald-500' : 'bg-muted-foreground/50';
  const statusLabel = isDetected
    ? t('settings.agentsTab.detected')
    : t('settings.agentsTab.notDetected');

  return (
    <IntegrationRow
      key={agent.id}
      logoSrc={logo}
      icon={
        logo ? undefined : (
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )
      }
      name={agent.name}
      onNameClick={handleNameClick}
      status={agent.status}
      statusLabel={statusLabel}
      showStatusPill={false}
      installCommand={agent.installCommand}
      middle={
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${indicatorClass}`} />
          {statusLabel}
        </span>
      }
      rightExtra={
        <span className="flex items-center gap-1">
          {!isDetected && runtimeId ? (
            <AgentInstallButton
              agentId={runtimeId}
              canInstall={!!agent.installCommand}
              isInstalled={isDetected}
              isInstalling={actions.isInstalling(runtimeId)}
              tooltipSide="top"
              onInstall={() => actions.onInstallClick(agent)}
            />
          ) : null}
          {/* Execution settings (incl. setting an absolute CLI path) stays
              reachable even when undetected — that's the escape hatch when a
              binary lives outside the probed PATH. */}
          <TooltipProvider delay={150}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => actions.onSettingsClick(agent.id)}
                    className={ICON_BUTTON}
                    aria-label={t('settings.agentsTab.executionSettingsAria', { name: agent.name })}
                  >
                    <Settings2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                }
              />
              <TooltipContent side="top" className="text-xs">
                {t('settings.agentsTab.executionSettings')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
      }
    />
  );
};

export const CliAgentsList: React.FC = observer(() => {
  const { t } = useTranslation();
  const [customModalAgentId, setCustomModalAgentId] = useState<string | null>(null);
  const { toast } = useToast();
  const agentStatuses = appState.dependencies.agentStatuses;

  const sortedAgents = useMemo(() => {
    return mapDependencyStatesToCli(agentStatuses).sort((a, b) => {
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (b.status === 'connected' && a.status !== 'connected') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [agentStatuses]);

  const handleInstall = useCallback(
    async (agent: CliAgentStatus) => {
      if (!isValidRuntimeId(agent.id) || appState.dependencies.isInstalling(agent.id)) {
        return;
      }

      const result = await appState.dependencies.install(agent.id);

      if (result.success) {
        toast({
          title: t('settings.agentsTab.agentInstalled'),
          description: t('settings.agentsTab.agentInstalledDescription', { name: agent.name }),
        });
        return;
      }

      toast({
        title: t('settings.agentsTab.installFailed'),
        description: getAgentInstallErrorMessage(result.error),
        variant: 'destructive',
      });
    },
    [toast, t]
  );

  const rowActions = useMemo<AgentRowActions>(
    () => ({
      isInstalling: (id) => appState.dependencies.isInstalling(id),
      onInstallClick: (agent) => {
        void handleInstall(agent);
      },
      onSettingsClick: setCustomModalAgentId,
      t,
    }),
    [handleInstall, t]
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {sortedAgents.map((agent) => renderAgentRow(agent, rowActions))}
      </div>

      <CustomCommandModal
        isOpen={customModalAgentId !== null}
        onClose={() => setCustomModalAgentId(null)}
        runtimeId={customModalAgentId ?? ''}
      />
    </div>
  );
});
