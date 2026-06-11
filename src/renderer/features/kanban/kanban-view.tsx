import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { KanbanBoard } from './components/KanbanBoard';

export function KanbanTitlebar() {
  return <Titlebar />;
}

export function KanbanMainPanel() {
  return <KanbanBoard />;
}

export const kanbanView = {
  TitlebarSlot: KanbanTitlebar,
  MainPanel: KanbanMainPanel,
};
