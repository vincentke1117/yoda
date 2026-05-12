import { ExternalLink, FileText, Hammer, Layers, Settings2, Wrench } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getProvider,
  type AgentProviderDefinition,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import { rpc } from '@renderer/lib/ipc';
import { agentMeta } from '@renderer/lib/providers/meta';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import { AgentTabHooks } from './AgentTabHooks';
import { AgentTabMaaS } from './AgentTabMaaS';
import { AgentTabMemory } from './AgentTabMemory';
import { AgentTabSettings } from './AgentTabSettings';
import { AgentTabSkills } from './AgentTabSkills';

type TabId = 'maas' | 'memory' | 'hooks' | 'skills' | 'settings';

const TABS: Array<{
  id: TabId;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
}> = [
  { id: 'maas', icon: Layers, labelKey: 'agents.tabs.maas' },
  { id: 'memory', icon: FileText, labelKey: 'agents.tabs.memory' },
  { id: 'hooks', icon: Hammer, labelKey: 'agents.tabs.hooks' },
  { id: 'skills', icon: Wrench, labelKey: 'agents.tabs.skills' },
  { id: 'settings', icon: Settings2, labelKey: 'agents.tabs.settings' },
];

export const AgentDetailPanel: React.FC<{ agentId: AgentProviderId }> = observer(
  function AgentDetailPanel({ agentId }) {
    const { t } = useTranslation();
    const provider = getProvider(agentId);
    const [activeTab, setActiveTab] = useState<TabId>('maas');

    if (!provider) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t('agents.notFound')}
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col">
        <AgentHeader provider={provider} />
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background-secondary px-4">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition',
                  isActive
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'maas' && <AgentTabMaaS agentId={agentId} />}
          {activeTab === 'memory' && <AgentTabMemory agentId={agentId} />}
          {activeTab === 'hooks' && <AgentTabHooks agentId={agentId} />}
          {activeTab === 'skills' && <AgentTabSkills agentId={agentId} />}
          {activeTab === 'settings' && <AgentTabSettings agentId={agentId} />}
        </div>
      </div>
    );
  }
);

const AgentHeader: React.FC<{ provider: AgentProviderDefinition }> = observer(function AgentHeader({
  provider,
}) {
  const { t } = useTranslation();
  const meta = agentMeta[provider.id];
  const dep = appState.dependencies.agentStatuses[provider.id];
  const connected = dep?.status === 'available';

  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-border px-6 py-4">
      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded">
        {meta?.icon ? (
          meta.isSvg ? (
            <span
              className={cn('h-full w-full', meta.invertInDark && 'dark:invert')}
              dangerouslySetInnerHTML={{ __html: meta.icon }}
            />
          ) : (
            <img
              src={meta.icon}
              alt={meta.alt ?? provider.name}
              className="h-full w-full object-contain"
            />
          )
        ) : null}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{provider.name}</h2>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]',
              connected
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-muted/40 text-muted-foreground'
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                connected ? 'bg-emerald-500' : 'bg-muted-foreground/60'
              )}
            />
            {connected
              ? dep?.version
                ? `v${dep.version}`
                : t('agents.detected')
              : t('agents.notDetected')}
          </span>
        </div>
        {provider.description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {provider.description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {provider.docUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void rpc.app.openExternal(provider.docUrl!)}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            {t('agents.docs')}
          </Button>
        )}
      </div>
    </div>
  );
});
