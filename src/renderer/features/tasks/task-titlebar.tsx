import { FileDiff, FolderOpen, ListChecks, Pin, Sparkles, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { Issue } from '@shared/tasks';
import {
  asMounted,
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import {
  getRegisteredTaskData,
  getTaskStore,
  taskDisplayName,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { ConnectionStatusDot } from '@renderer/lib/components/connection-status-dot';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Separator } from '@renderer/lib/ui/separator';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Toggle } from '@renderer/lib/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { DevServerPills } from './components/dev-server-pills';
import { ProviderLogo } from './components/issue-selector/issue-selector';
import { TaskGitDiffStats } from './components/task-git-diff-stats';
import { type SidebarTab } from './types';

export const TaskTitlebar = observer(function TaskTitlebar() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  if (kind !== 'ready') {
    return <PendingTaskTitlebar taskId={taskId} projectId={projectId} />;
  }

  return <ActiveTaskTitlebar taskId={taskId} projectId={projectId} />;
});

const PendingTaskTitlebar = observer(function PendingTaskTitlebar({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId)!;
  const projectName = projectDisplayName(getProjectStore(projectId));
  const name = taskDisplayName(taskStore);

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2 text-sm text-foreground-muted">
          <span className="flex items-center gap-1">
            <span className="text-sm text-foreground-passive">{projectName}</span>
            <span className="text-sm text-foreground-passive">/</span>
            {name}
          </span>
        </div>
      }
    />
  );
});

const ActiveTaskTitlebar = observer(function ActiveTaskTitlebar({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const taskStore = getTaskStore(projectId, taskId)!;
  const taskPayload = getRegisteredTaskData(projectId, taskId)!;
  const provisionedTask = useProvisionedTask();
  const { taskView } = provisionedTask;
  const showRename = useShowModal('renameTaskModal');

  const projectStore = asMounted(getProjectStore(projectId));

  const projectName = projectDisplayName(getProjectStore(projectId));

  const isRemoteProject = projectStore?.data.type === 'ssh';
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2 min-w-0">
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground min-w-0 rounded px-1 -mx-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              const currentName = taskDisplayName(taskStore);
              if (!currentName) return;
              showRename({ projectId, taskId, currentName });
            }}
            title={t('tasks.rename.title')}
          >
            <span className="flex items-center gap-1 min-w-0">
              <span className="text-sm text-foreground-passive shrink-0 inline-flex items-baseline gap-1">
                {projectName}
                <span className="text-[11px] text-foreground-passive/70 font-mono truncate max-w-28">
                  ({provisionedTask.workspace.git.branchName})
                </span>
              </span>
              <span className="text-sm text-foreground-passive shrink-0">/</span>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate">{taskDisplayName(taskStore)}</span>
                <ConnectionStatusDot state={provisionedTask.workspace.connectionState} />
              </span>
            </span>
          </button>
          <TaskGitDiffStats task={taskStore} />
          {taskPayload.linkedIssue ? <LinkedIssueBadge issue={taskPayload.linkedIssue} /> : null}
          <button
            className={cn(
              'text-foreground-muted ml-1',
              taskPayload.isPinned && 'text-muted-foreground'
            )}
            onClick={() => taskStore.setPinned(!taskPayload.isPinned)}
          >
            <Pin
              className={cn('size-3.5', taskPayload.isPinned && 'text-foreground-muted')}
              fill={taskPayload.isPinned ? 'currentColor' : 'none'}
            />
          </button>
        </div>
      }
      rightSlot={
        <div className="flex items-center gap-2">
          <DevServerPills projectId={projectId} taskId={taskId} />
          {!isRemoteProject && (
            <OpenInMenu path={provisionedTask.path} className="h-7 bg-background" borderless />
          )}
          <Separator orientation="vertical" className="h-5 self-center!" />
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
                  <Terminal className="size-3.5" />
                </Toggle>
              }
            />
            <TooltipContent>
              {t('tasks.toggleTerminal')} <ShortcutHint settingsKey="toggleTerminalDrawer" />
            </TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="h-5 self-center!" />
          <ToggleGroup
            value={taskView.isSidebarCollapsed ? [] : [taskView.sidebarTab]}
            onValueChange={([tab]) => {
              if (!tab) {
                taskView.setSidebarCollapsed(true);
              } else {
                taskView.setSidebarTab(tab as SidebarTab);
                taskView.setSidebarCollapsed(false);
              }
            }}
            size="icon-sm"
            className="border-none"
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem size="icon-sm" value="task" aria-label="Task">
                    <ListChecks className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>Task</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem size="icon-sm" value="changes" aria-label={t('tasks.changes')}>
                    <FileDiff className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>{t('tasks.changes')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem size="icon-sm" value="files" aria-label={t('tasks.files')}>
                    <FolderOpen className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>{t('tasks.files')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    size="icon-sm"
                    value="context"
                    aria-label={t('tasks.contextTab')}
                  >
                    <Sparkles className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>{t('tasks.contextTab')}</TooltipContent>
            </Tooltip>
          </ToggleGroup>
        </div>
      }
    />
  );
});

function LinkedIssueBadge({ issue }: { issue: Issue }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            disabled={!issue.url}
            onClick={() => {
              if (issue.url) void rpc.app.openExternal(issue.url);
            }}
            className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground-muted hover:bg-muted/30 disabled:cursor-default disabled:opacity-60"
          >
            <ProviderLogo provider={issue.provider} className="h-3 w-3" />
            <span className="font-mono">{issue.identifier}</span>
          </button>
        }
      />
      <TooltipContent>{issue.title || issue.identifier}</TooltipContent>
    </Tooltip>
  );
}
