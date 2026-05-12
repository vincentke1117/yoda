import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { AgentsView } from './components/AgentsView';

export function AgentsTitlebar() {
  return <Titlebar />;
}

export function AgentsMainPanel() {
  return <AgentsView />;
}

export const agentsView = {
  TitlebarSlot: AgentsTitlebar,
  MainPanel: AgentsMainPanel,
};
