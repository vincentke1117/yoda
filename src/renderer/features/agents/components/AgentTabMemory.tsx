import { FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { expandHome, resolveAgentPaths } from './agent-paths';
import { AgentSection } from './AgentSection';

export const AgentTabMemory: React.FC<{ agentId: AgentProviderId }> = observer(
  function AgentTabMemory({ agentId }) {
    const { t } = useTranslation();
    const provider = getProvider(agentId);
    const paths = resolveAgentPaths(agentId);

    if (!provider) return null;

    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <AgentSection
          title={t('agents.memory.title')}
          description={t('agents.memory.description', { name: provider.name })}
        >
          {paths.memory ? (
            <PathRow path={paths.memory} />
          ) : (
            <UnsupportedNote text={t('agents.memory.unsupported', { name: provider.name })} />
          )}
        </AgentSection>
      </div>
    );
  }
);

const PathRow: React.FC<{ path: string }> = ({ path }) => {
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

const UnsupportedNote: React.FC<{ text: string }> = ({ text }) => (
  <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
    {text}
  </p>
);
