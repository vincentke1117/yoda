import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { RuntimeCustomConfigs } from '@shared/app-settings';
import type { RuntimeId } from '@shared/runtime-registry';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { agentConfig } from '@renderer/utils/agentConfig';
import { getAgentInstallErrorMessage } from './agent-install';
import { buildAgentGroups, getAssumedInstalledAgents } from './agent-selector-options';

export function useAgentAvailability({
  connectionId,
  value,
}: {
  connectionId?: string;
  value: RuntimeId | null;
}) {
  const dependencyResource = connectionId
    ? appState.dependencies.getRemote(connectionId)
    : appState.dependencies.local;
  const dependencyData = dependencyResource.data;
  const { toast } = useToast();
  const { data: runtimeConfigs = {} } = useQuery<RuntimeCustomConfigs>({
    queryKey: ['runtimeSettings', 'all'] as const,
    queryFn: () => rpc.runtimeSettings.getAll() as Promise<RuntimeCustomConfigs>,
    staleTime: 60_000,
  });

  const disabledAgents = useMemo(
    () =>
      Object.entries(runtimeConfigs)
        .filter(([, config]) => config.disabled === true)
        .map(([id]) => id),
    [runtimeConfigs]
  );

  const installedAgents = useMemo(
    () =>
      dependencyData
        ? Object.entries(dependencyData)
            .filter(([, state]) => state.category === 'agent' && state.status === 'available')
            .map(([id]) => id)
        : [],
    [dependencyData]
  );

  const assumedInstalledAgents = useMemo(
    () => getAssumedInstalledAgents(value, dependencyData),
    [value, dependencyData]
  );

  const groups = useMemo(
    () => buildAgentGroups(installedAgents, assumedInstalledAgents, disabledAgents),
    [installedAgents, assumedInstalledAgents, disabledAgents]
  );
  const installingAgents = new Set<RuntimeId>();
  for (const group of groups) {
    for (const item of group.items) {
      if (appState.dependencies.isInstalling(item.agentId, connectionId)) {
        installingAgents.add(item.agentId);
      }
    }
  }

  async function installAgent(agentId: RuntimeId): Promise<void> {
    if (appState.dependencies.isInstalling(agentId, connectionId)) return;
    const result = await appState.dependencies.install(agentId, connectionId);
    if (!result.success) {
      toast({
        title: 'Install failed',
        description: getAgentInstallErrorMessage(result.error),
        variant: 'destructive',
      });
      return;
    }

    toast({ title: 'Agent installed', description: `${agentConfig[agentId].name} is ready.` });
  }

  return {
    groups,
    dependencyData,
    installingAgents,
    installAgent,
  };
}
