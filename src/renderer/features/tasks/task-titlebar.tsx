import { PanelBottom, PanelRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { getTaskStore, taskViewKind } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Toggle } from '@renderer/lib/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { DevServerPills } from './components/dev-server-pills';

/**
 * Task titlebar: the task identity lives in the top-level tab strip (the
 * scope's Overview index tab) — no breadcrumb here. Only three right-side
 * controls remain: open-in, terminal drawer, sidebar toggle. The sidebar
 * hosts its own tab strip for panel switching.
 */
export const TaskTitlebar = observer(function TaskTitlebar() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  if (kind !== 'ready') {
    return <Titlebar />;
  }

  return <ActiveTaskTitlebar projectId={projectId} taskId={taskId} />;
});

const ActiveTaskTitlebar = observer(function ActiveTaskTitlebar({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const provisionedTask = useProvisionedTask();
  const { taskView } = provisionedTask;
  const projectStore = asMounted(getProjectStore(projectId));
  const isRemoteProject = projectStore?.data.type === 'ssh';

  return (
    <Titlebar
      rightSlot={
        <div className="flex items-center gap-2">
          <DevServerPills projectId={projectId} taskId={taskId} />
          {!isRemoteProject && (
            <OpenInMenu path={provisionedTask.path} className="h-7 bg-background" borderless />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="sm"
                  pressed={taskView.isTerminalDrawerOpen}
                  className="border-none"
                  onPressedChange={() =>
                    taskView.setTerminalDrawerOpen(!taskView.isTerminalDrawerOpen)
                  }
                >
                  <PanelBottom className="size-3.5" />
                </Toggle>
              }
            />
            <TooltipContent>
              {t('tasks.toggleTerminal')} <ShortcutHint settingsKey="toggleTerminalDrawer" />
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="sm"
                  pressed={!taskView.isSidebarCollapsed}
                  className="border-none"
                  onPressedChange={() => taskView.setSidebarCollapsed(!taskView.isSidebarCollapsed)}
                >
                  <PanelRight className="size-3.5" />
                </Toggle>
              }
            />
            <TooltipContent>
              {t('tasks.toggleSidebar')} <ShortcutHint settingsKey="toggleRightSidebar" />
            </TooltipContent>
          </Tooltip>
        </div>
      }
    />
  );
});
