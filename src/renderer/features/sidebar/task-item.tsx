import { Archive, Loader2, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { selectCurrentPr } from '@shared/pull-requests';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { TaskSidebarAgentStatus } from '@renderer/features/sidebar/task-sidebar-agent-status';
import { useArchiveTask } from '@renderer/features/tasks/archive-task';
import {
  TaskActionsMenu,
  TaskContextMenu,
} from '@renderer/features/tasks/components/task-context-menu';
import {
  buildTaskMenuSessionFields,
  getTaskMenuConversation,
  resolveTaskMenuSessionFields,
  selectPreferredConversation,
} from '@renderer/features/tasks/components/task-menu-session-info';
import { type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { cn } from '@renderer/utils/utils';
import { PrBadge } from '../../lib/components/pr-badge';
import { SidebarItemMiniButton, SidebarMenuRow } from './sidebar-primitives';

interface SidebarTaskItemProps {
  taskId: string;
  projectId: string;
  /**
   * - `underProject` (default): nested under a project header, deeper indent.
   * - `pinned`: tight padding for the pinned strip.
   * - `flat`: top-level row in the no-grouping / type / activity views; shows the project tag.
   */
  rowVariant?: 'underProject' | 'pinned' | 'flat';
}

export const SidebarTaskItem = observer(function SidebarTaskItem({
  taskId,
  projectId,
  rowVariant = 'underProject',
}: SidebarTaskItemProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showArchiveWithNote = useShowModal('archiveTaskWithNoteModal');
  const showConfirm = useShowModal('confirmActionModal');
  const showManageRunScripts = useShowModal('manageRunScriptsModal');
  const showEditPreArchiveCommand = useShowModal('editPreArchiveCommandModal');

  const { currentView } = useWorkspaceSlots();
  const { params } = useParams('task');
  const isActive =
    currentView === 'task' && params.taskId === taskId && params.projectId === projectId;
  const [isMenuOpen, setMenuOpen] = useState(false);

  const task = getTaskStore(projectId, taskId)!;
  const taskManager = getTaskManagerStore(projectId);
  const { archiveTask, hasPreArchiveCommand } = useArchiveTask(projectId);
  const [isArchiving, setIsArchiving] = useState(false);

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));
  const isAgentWorking = taskAgentStatus(task) === 'working';

  const taskName = task.data.name;
  const taskIndentClass = rowVariant === 'underProject' ? 'pl-8' : 'pl-2';

  const handleProvision = () => {
    if (task.state !== 'unprovisioned' || task.phase !== 'idle') return;
    void taskManager?.provisionTask(taskId);
  };

  const handleArchive = (options?: { skipPreCommand?: boolean }) => {
    if (isArchiving) return;
    void (async () => {
      try {
        setIsArchiving(true);
        await archiveTask(taskId, options);
      } finally {
        setIsArchiving(false);
      }
    })();
  };

  const handleArchiveWithNote = () => {
    showArchiveWithNote({
      projectId,
      taskId,
      taskName,
    });
  };

  const handleRename = () => showRename({ projectId, taskId, currentName: taskName });

  const handleDelete = () =>
    showConfirm({
      title: t('sidebar.deleteTask.title'),
      description: t('sidebar.deleteTask.description', { name: taskName }),
      confirmLabel: t('sidebar.deleteTask.confirmLabel'),
      onSuccess: () => {
        void taskManager?.deleteTask(taskId);
        if (isActive) navigate('project', { projectId });
      },
    });

  const canPin = task.state !== 'unregistered';
  const canMarkReview = task.state !== 'unregistered';
  const needsReview = task.data.needsReview;

  const provisionedTask = asProvisioned(task);
  const branchName =
    provisionedTask?.workspace.git.branchName ??
    ('taskBranch' in task.data ? task.data.taskBranch : undefined);
  const workspace = provisionedTask?.workspace;
  const handleReconnect =
    workspace?.connectionState != null ? () => workspace.reconnect() : undefined;

  const project = getProjectStore(projectId);
  const projectName =
    project?.state === 'unregistered' ? projectId : (project?.displayName ?? projectId);
  const projectPath = project?.data?.path;

  const menuConversation = getTaskMenuConversation(provisionedTask);
  const sessionInfoCwd = provisionedTask?.path ?? projectPath;
  const sessionFields = menuConversation
    ? buildTaskMenuSessionFields(menuConversation, sessionInfoCwd)
    : {};
  const hasStoredConversations = Object.values(task.conversationStats).some((count) => count > 0);
  const resolveSessionInfo = menuConversation
    ? () => resolveTaskMenuSessionFields(menuConversation, sessionInfoCwd)
    : hasStoredConversations && task.state !== 'unregistered'
      ? async () => {
          const conversations = await rpc.conversations.getConversationsForTask(projectId, taskId);
          const conversation = selectPreferredConversation(conversations);
          return conversation
            ? resolveTaskMenuSessionFields(conversation, sessionInfoCwd)
            : undefined;
        }
      : undefined;

  const handleConfigureScripts = () => showManageRunScripts({ projectId, projectName });

  const handleRunScript = () => {
    if (!provisionedTask) {
      navigate('task', { projectId, taskId });
      return;
    }
    void rpc.terminals
      .runLifecycleScript({
        projectId,
        workspaceId: provisionedTask.workspaceId,
        type: 'run',
      })
      .catch(() => {});
  };

  const handleViewStatus = () => {
    navigate('task', { projectId, taskId });
  };

  const openPreferredConversationIfEmpty = () => {
    if (!provisionedTask) return;
    const { taskView } = provisionedTask;
    if (taskView.tabManager.resolvedTabs.length > 0) return;
    if (taskView.tabManager.openPreferredConversation()) {
      taskView.setFocusedRegion('main');
    }
  };

  const handleOpenDetails = () => {
    handleProvision();
    openPreferredConversationIfEmpty();
    navigate('task', { projectId, taskId });
  };

  const menuActions = {
    projectId,
    projectName,
    taskId,
    taskName,
    isPinned: task.data.isPinned,
    canPin,
    isArchived: false,
    needsReview,
    canMarkReview,
    branchName,
    ...sessionFields,
    resolveSessionInfo,
    projectPath,
    workingDirectory: provisionedTask?.path,
    openDetailsLabel: t('tasks.context.openDetails'),
    onOpenDetails: handleOpenDetails,
    onPin: () => void task.setPinned(true),
    onUnpin: () => void task.setPinned(false),
    onMarkNeedsReview: () => void task.setNeedsReview(true),
    onUnmarkNeedsReview: () => void task.setNeedsReview(false),
    onRename: handleRename,
    onArchive: handleArchive,
    onArchiveSkipPreCommand: hasPreArchiveCommand
      ? () => handleArchive({ skipPreCommand: true })
      : undefined,
    onArchiveWithNote: handleArchiveWithNote,
    onConfigurePreArchive: () => showEditPreArchiveCommand({}),
    onReconnect: handleReconnect,
    onDelete: handleDelete,
    onRunScript: handleRunScript,
    canRunScript: Boolean(provisionedTask),
    onConfigureScripts: handleConfigureScripts,
    onViewStatus: handleViewStatus,
  };

  return (
    <TaskContextMenu {...menuActions}>
      <SidebarMenuRow
        className={cn(
          'group/row flex items-center justify-between px-1 h-8 gap-1',
          taskIndentClass
        )}
        isActive={isActive}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleOpenDetails}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handleRename();
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-hidden">
          <span
            className={cn(
              'min-w-0 truncate text-left transition-colors',
              (isBootstrapping || isArchiving) && 'text-foreground/40'
            )}
          >
            {taskName}
          </span>
          {rowVariant === 'flat' && (
            <span className="shrink-0 truncate max-w-[8rem] rounded-sm bg-background-tertiary-2 px-1 text-[10px] uppercase tracking-wide text-foreground-tertiary">
              {projectName}
            </span>
          )}
          <RenderPrBadge task={task} />
        </div>
        <div
          className={cn(
            'items-center gap-0.5',
            isMenuOpen || isArchiving
              ? 'flex'
              : isAgentWorking
                ? 'hidden'
                : 'hidden group-hover/row:flex'
          )}
        >
          <TaskActionsMenu
            {...menuActions}
            open={isMenuOpen}
            onOpenChange={setMenuOpen}
            trigger={
              <SidebarItemMiniButton
                type="button"
                aria-label={t('sidebar.runScripts.menuLabel')}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </SidebarItemMiniButton>
            }
          />
          <SidebarItemMiniButton
            type="button"
            aria-label={t('sidebar.archiveTask')}
            disabled={isArchiving}
            onClick={(e) => {
              e.stopPropagation();
              handleArchive();
            }}
          >
            {isArchiving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
          </SidebarItemMiniButton>
        </div>
        <div
          className={cn(
            'items-center',
            isMenuOpen || isArchiving
              ? 'hidden'
              : isAgentWorking
                ? 'flex'
                : 'flex group-hover/row:hidden'
          )}
        >
          <TaskSidebarAgentStatus task={task} needsReview={needsReview} />
        </div>
      </SidebarMenuRow>
    </TaskContextMenu>
  );
});

const RenderPrBadge = observer(function RenderPrBadge({ task }: { task: TaskStore }) {
  if (!('prs' in task.data)) return null;
  const pr = selectCurrentPr(task.data.prs);
  return pr ? <PrBadge variant="compact" pr={pr} /> : null;
});
