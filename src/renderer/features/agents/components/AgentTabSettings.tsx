import { FolderOpen, Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import CustomCommandModal from '@renderer/features/settings/components/CustomCommandModal';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { expandHome, resolveAgentPaths } from './agent-paths';
import { AgentSection } from './AgentSection';

export const AgentTabSettings: React.FC<{ agentId: AgentProviderId }> = observer(
  function AgentTabSettings({ agentId }) {
    const { t } = useTranslation();
    const [customOpen, setCustomOpen] = useState(false);
    const provider = getProvider(agentId);
    const paths = resolveAgentPaths(agentId);

    if (!provider) return null;

    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <AgentSection
          title={t('agents.settings.execTitle')}
          description={t('agents.settings.execDescription', { name: provider.name })}
        >
          <Button variant="outline" size="sm" onClick={() => setCustomOpen(true)}>
            <Settings2 className="mr-1 h-3.5 w-3.5" />
            {t('agents.settings.editExec')}
          </Button>
        </AgentSection>

        <AgentSection
          title={t('agents.settings.configTitle')}
          description={t('agents.settings.configDescription')}
        >
          {paths.config ? (
            <ConfigPathRow path={paths.config} />
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              {t('agents.settings.noConfig', { name: provider.name })}
            </p>
          )}
          {paths.settings && paths.settings !== paths.config && (
            <div className="mt-2">
              <ConfigPathRow path={paths.settings} />
            </div>
          )}
        </AgentSection>

        <CustomCommandModal
          isOpen={customOpen}
          onClose={() => setCustomOpen(false)}
          providerId={agentId}
        />
      </div>
    );
  }
);

const ConfigPathRow: React.FC<{ path: string }> = ({ path }) => {
  const { t } = useTranslation();
  const handleOpen = async () => {
    const home = await rpc.app.getHomeDir();
    await rpc.app.openIn({ app: 'finder', path: expandHome(path, home) });
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <code className="truncate font-mono text-xs text-foreground">{path}</code>
      <Button variant="ghost" size="sm" onClick={() => void handleOpen()}>
        <FolderOpen className="mr-1 h-3.5 w-3.5" />
        {t('agents.openInFinder')}
      </Button>
    </div>
  );
};
