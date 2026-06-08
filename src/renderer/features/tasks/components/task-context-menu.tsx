import type { TFunction } from 'i18next';
import {
  Activity,
  Archive,
  ArchiveX,
  CircleDot,
  CircleSlash,
  Copy,
  FileText,
  FolderInput,
  Info,
  Pencil,
  Pin,
  PinOff,
  PlayCircle,
  RotateCcw,
  Settings2,
  Terminal,
  Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { ALL_WORKSPACES_ID } from '@shared/workspaces';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { workspaceStore } from '@renderer/lib/stores/app-state';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { buildTaskBasicInfo, type TaskBasicInfoFields } from './task-menu-basic-info';

interface TaskSessionInfoFields {
  providerId?: AgentProviderId;
  sessionId?: string;
  sessionTitle?: string;
  providerName?: string;
  resumeCommand?: string;
  running?: boolean;
  tmuxEnabled?: boolean;
}

interface TaskMenuInfoFields extends TaskBasicInfoFields, TaskSessionInfoFields {
  projectPath?: string;
  workingDirectory?: string;
}

interface TaskMenuActions extends TaskMenuInfoFields {
  isPinned: boolean;
  canPin: boolean;
  isArchived: boolean;
  needsReview: boolean;
  canMarkReview: boolean;
  resolveSessionInfo?: () =>
    | TaskSessionInfoFields
    | undefined
    | Promise<TaskSessionInfoFields | undefined>;
  openDetailsLabel?: string;
  onOpenDetails?: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onMarkNeedsReview: () => void;
  onUnmarkNeedsReview: () => void;
  onRename: () => void;
  onArchive: () => void;
  onArchiveSkipPreCommand?: () => void;
  onArchiveWithNote?: () => void;
  onConfigurePreArchive?: () => void;
  onRestore?: () => void;
  onReconnect?: () => void;
  /** Restart the session. Pass a tmux override to force tmux on/off for this restart only. */
  onRestartSession?: (tmuxOverride?: boolean) => void;
  onDelete: () => void;
  onRunScript?: () => void;
  canRunScript?: boolean;
  onConfigureScripts?: () => void;
  onViewStatus?: () => void;
  /** Current sidebar workspace assignment (null = default). Projectless tasks only. */
  currentWorkspaceId?: string | null;
  /** Assign this task to a sidebar workspace, or null for the default. */
  onAssignWorkspace?: (workspaceId: string | null) => void;
}

/** Session-management group; restart is rendered inline after the last item in it. */
const TASK_MANAGEMENT_GROUP = 2;

interface MenuItemDescriptor {
  key: string;
  group: number;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive';
}

function useMenuItems(actions: TaskMenuActions): MenuItemDescriptor[] {
  const { t } = useTranslation();
  const items: MenuItemDescriptor[] = [];

  // group 0 — primary navigation
  if (actions.onOpenDetails) {
    items.push({
      key: 'open-details',
      group: 0,
      icon: Info,
      label: actions.openDetailsLabel ?? t('tasks.context.openDetails'),
      onSelect: actions.onOpenDetails,
    });
  }

  // group 1 — copy
  if (actions.taskId) {
    items.push({
      key: 'copy-task-id',
      group: 1,
      icon: Copy,
      label: t('tasks.context.copyTaskId'),
      onSelect: () => {
        void copyTaskId(actions, t);
      },
    });
  }
  if (actions.taskId || actions.taskName) {
    items.push({
      key: 'copy-task-basic-info',
      group: 1,
      icon: Copy,
      label: t('tasks.context.copyTaskBasicInfo'),
      onSelect: () => {
        void copyTaskBasicInfo(actions, t);
      },
    });
  }

  // group 2 — task management
  if (actions.canPin) {
    items.push(
      actions.isPinned
        ? {
            key: 'unpin',
            group: 2,
            icon: PinOff,
            label: t('tasks.context.unpinTask'),
            onSelect: actions.onUnpin,
          }
        : {
            key: 'pin',
            group: 2,
            icon: Pin,
            label: t('tasks.context.pinTask'),
            onSelect: actions.onPin,
          }
    );
  }
  items.push({
    key: 'rename',
    group: 2,
    icon: Pencil,
    label: t('common.rename'),
    onSelect: actions.onRename,
  });
  if (actions.canMarkReview) {
    items.push(
      actions.needsReview
        ? {
            key: 'unmark-review',
            group: 2,
            icon: CircleSlash,
            label: t('tasks.context.unmarkReview'),
            onSelect: actions.onUnmarkNeedsReview,
          }
        : {
            key: 'mark-review',
            group: 2,
            icon: CircleDot,
            label: t('tasks.context.markForReview'),
            onSelect: actions.onMarkNeedsReview,
          }
    );
  }
  if (actions.onReconnect) {
    items.push({
      key: 'reconnect',
      group: 2,
      icon: RotateCcw,
      label: t('sidebar.reconnect'),
      onSelect: actions.onReconnect,
    });
  }
  // Restart is rendered as a submenu (tmux / no-tmux) directly in the menu bodies.

  // group 3 — archive / restore
  if (!actions.isArchived) {
    items.push({
      key: 'archive',
      group: 3,
      icon: Archive,
      label: t('tasks.context.archive'),
      onSelect: actions.onArchive,
    });
    if (actions.onArchiveSkipPreCommand) {
      items.push({
        key: 'archive-skip-pre',
        group: 3,
        icon: ArchiveX,
        label: t('tasks.context.archiveSkipPre'),
        onSelect: actions.onArchiveSkipPreCommand,
      });
    }
    if (actions.onArchiveWithNote) {
      items.push({
        key: 'archive-with-note',
        group: 3,
        icon: FileText,
        label: t('tasks.context.archiveWithNote'),
        onSelect: actions.onArchiveWithNote,
      });
    }
    if (actions.onConfigurePreArchive) {
      items.push({
        key: 'configure-pre-archive',
        group: 3,
        icon: Terminal,
        label: t('sidebar.configurePreArchive'),
        onSelect: actions.onConfigurePreArchive,
      });
    }
  }
  if (actions.isArchived && actions.onRestore) {
    items.push({
      key: 'restore',
      group: 3,
      icon: RotateCcw,
      label: t('projects.tasks.restore'),
      onSelect: actions.onRestore,
    });
  }

  // group 4 — run scripts
  if (actions.onRunScript) {
    items.push({
      key: 'run-script',
      group: 4,
      icon: PlayCircle,
      label: t('sidebar.runScripts.runScript'),
      onSelect: actions.onRunScript,
      disabled: actions.canRunScript === false,
    });
  }
  if (actions.onViewStatus) {
    items.push({
      key: 'view-status',
      group: 4,
      icon: Activity,
      label: t('sidebar.runScripts.scriptStatus'),
      onSelect: actions.onViewStatus,
    });
  }
  if (actions.onConfigureScripts) {
    items.push({
      key: 'configure-scripts',
      group: 4,
      icon: Settings2,
      label: t('sidebar.runScripts.configure'),
      onSelect: actions.onConfigureScripts,
    });
  }

  // group 5 — destructive
  items.push({
    key: 'delete',
    group: 5,
    icon: Trash2,
    label: t('common.delete'),
    onSelect: actions.onDelete,
    variant: 'destructive',
  });

  return items;
}

async function copyTaskBasicInfo(actions: TaskMenuActions, t: TFunction): Promise<void> {
  try {
    const fields = await resolveOptionalSessionInfoFields(actions);
    const contentSourcePath = await resolveSessionContentSourcePath(fields);
    const value = buildTaskBasicInfo(
      {
        ...fields,
        contentSourcePath,
      },
      {
        provider: t('tasks.context.taskInfo.provider'),
        project: t('tasks.context.taskInfo.project'),
        projectPath: t('tasks.context.taskInfo.projectPath'),
        task: t('tasks.context.taskInfo.task'),
        taskId: t('tasks.context.taskInfo.taskId'),
        branch: t('tasks.context.taskInfo.branch'),
        sessionId: t('tasks.context.taskInfo.sessionId'),
        contentSource: t('tasks.context.taskInfo.contentSource'),
        readInstruction: t('tasks.context.taskInfo.readInstruction'),
        readInstructionValue: t('tasks.context.taskInfo.readInstructionValue'),
      }
    );

    if (!value) {
      showCopyFailure(t);
      return;
    }

    await copyText(value, t, {
      success: t('tasks.context.taskBasicInfoCopied'),
      failure: t('tasks.context.copyFailed'),
    });
  } catch {
    showCopyFailure(t);
  }
}

async function copyTaskId(actions: TaskMenuActions, t: TFunction): Promise<void> {
  try {
    const taskId = actions.taskId?.trim();
    if (!taskId) {
      showCopyFailure(t);
      return;
    }

    await copyText(taskId, t, {
      success: t('tasks.context.taskIdCopied'),
      failure: t('tasks.context.copyFailed'),
    });
  } catch {
    showCopyFailure(t);
  }
}

async function resolveOptionalSessionInfoFields(
  actions: TaskMenuActions
): Promise<TaskMenuInfoFields> {
  try {
    return await resolveSessionInfoFields(actions);
  } catch {
    return actions;
  }
}

async function resolveSessionInfoFields(actions: TaskMenuActions): Promise<TaskMenuInfoFields> {
  const resolved = await actions.resolveSessionInfo?.();
  return { ...actions, ...(resolved ?? {}) };
}

async function resolveSessionContentSourcePath(
  fields: TaskMenuInfoFields
): Promise<string | undefined> {
  const cwd = firstTrimmed(fields.workingDirectory, fields.projectPath);
  const sessionId = fields.sessionId?.trim();
  if (!cwd || !sessionId) return undefined;

  try {
    if (fields.providerId === 'claude') {
      const context = await rpc.conversations.getClaudeSessionContext(cwd, sessionId);
      return context?.transcriptPath;
    }
    if (fields.providerId === 'codex') {
      const context = await rpc.conversations.getCodexSessionContext(
        cwd,
        sessionId,
        fields.sessionTitle
      );
      return context?.rolloutPath ?? undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function firstTrimmed(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

async function copyText(
  value: string,
  t: TFunction,
  messages: { success: string; failure: string }
) {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title: messages.success });
  } catch {
    toast({
      title: t('auth.copyFailed'),
      description: messages.failure,
      variant: 'destructive',
    });
  }
}

function showCopyFailure(t: TFunction): void {
  toast({
    title: t('auth.copyFailed'),
    description: t('tasks.context.copyFailed'),
    variant: 'destructive',
  });
}

const TaskWorkspaceContextSubmenu = observer(function TaskWorkspaceContextSubmenu({
  currentWorkspaceId,
  onAssign,
}: {
  currentWorkspaceId: string | null;
  onAssign: (workspaceId: string | null) => void;
}) {
  const { t } = useTranslation();
  if (workspaceStore.workspaces.length === 0) return null;
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger className="whitespace-nowrap">
          <FolderInput className="size-4" />
          {t('workspaces.moveToWorkspace')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup value={currentWorkspaceId ?? ALL_WORKSPACES_ID}>
            <ContextMenuRadioItem value={ALL_WORKSPACES_ID} onClick={() => onAssign(null)}>
              {t('workspaces.defaultWorkspace')}
            </ContextMenuRadioItem>
            {workspaceStore.workspaces.map((workspace) => (
              <ContextMenuRadioItem
                key={workspace.id}
                value={workspace.id}
                onClick={() => onAssign(workspace.id)}
              >
                {workspace.name}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
});

function RestartSessionContextSubmenu({
  onRestart,
}: {
  onRestart: (tmuxOverride?: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="whitespace-nowrap">
        <RotateCcw className="size-4" />
        {t('tasks.context.restartSession')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem className="whitespace-nowrap" onClick={() => onRestart(true)}>
          {t('tasks.context.restartSessionWithTmux')}
        </ContextMenuItem>
        <ContextMenuItem className="whitespace-nowrap" onClick={() => onRestart(false)}>
          {t('tasks.context.restartSessionWithoutTmux')}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function RestartSessionDropdownSubmenu({
  onRestart,
}: {
  onRestart: (tmuxOverride?: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="whitespace-nowrap">
        <RotateCcw className="size-4" />
        {t('tasks.context.restartSession')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem className="whitespace-nowrap" onClick={() => onRestart(true)}>
          {t('tasks.context.restartSessionWithTmux')}
        </DropdownMenuItem>
        <DropdownMenuItem className="whitespace-nowrap" onClick={() => onRestart(false)}>
          {t('tasks.context.restartSessionWithoutTmux')}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

const TaskWorkspaceDropdownSubmenu = observer(function TaskWorkspaceDropdownSubmenu({
  currentWorkspaceId,
  onAssign,
}: {
  currentWorkspaceId: string | null;
  onAssign: (workspaceId: string | null) => void;
}) {
  const { t } = useTranslation();
  if (workspaceStore.workspaces.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="whitespace-nowrap">
          <FolderInput className="size-4" />
          {t('workspaces.moveToWorkspace')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={currentWorkspaceId ?? ALL_WORKSPACES_ID}>
            <DropdownMenuRadioItem value={ALL_WORKSPACES_ID} onClick={() => onAssign(null)}>
              {t('workspaces.defaultWorkspace')}
            </DropdownMenuRadioItem>
            {workspaceStore.workspaces.map((workspace) => (
              <DropdownMenuRadioItem
                key={workspace.id}
                value={workspace.id}
                onClick={() => onAssign(workspace.id)}
              >
                {workspace.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
});

interface TaskContextMenuProps extends TaskMenuActions {
  children: React.ReactNode;
}

export function TaskContextMenu({ children, ...actions }: TaskContextMenuProps) {
  const items = useMenuItems(actions);
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-max overflow-x-visible">
        {items.map((item, index) => {
          const prev = items[index - 1];
          const showSeparator = prev && prev.group !== item.group;
          const Icon = item.icon;
          // Restart sits with the session-management group (2); render it inline
          // right after that group rather than dangling below the destructive item.
          const showRestartAfter =
            actions.onRestartSession &&
            item.group === TASK_MANAGEMENT_GROUP &&
            items[index + 1]?.group !== TASK_MANAGEMENT_GROUP;
          return (
            <React.Fragment key={item.key}>
              {showSeparator && <ContextMenuSeparator />}
              <ContextMenuItem
                disabled={item.disabled}
                variant={item.variant}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onSelect();
                }}
                className="whitespace-nowrap"
              >
                <Icon className="size-4" />
                {item.label}
              </ContextMenuItem>
              {showRestartAfter && actions.onRestartSession && (
                <RestartSessionContextSubmenu onRestart={actions.onRestartSession} />
              )}
            </React.Fragment>
          );
        })}
        {actions.onAssignWorkspace && (
          <TaskWorkspaceContextSubmenu
            currentWorkspaceId={actions.currentWorkspaceId ?? null}
            onAssign={actions.onAssignWorkspace}
          />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface TaskActionsMenuProps extends TaskMenuActions {
  trigger: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
}

export function TaskActionsMenu({
  trigger,
  open,
  onOpenChange,
  align = 'end',
  ...actions
}: TaskActionsMenuProps) {
  const items = useMenuItems(actions);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align={align} className="w-max min-w-44 overflow-x-visible">
        {items.map((item, index) => {
          const prev = items[index - 1];
          const showSeparator = prev && prev.group !== item.group;
          const Icon = item.icon;
          // Restart sits with the session-management group (2); render it inline
          // right after that group rather than dangling below the destructive item.
          const showRestartAfter =
            actions.onRestartSession &&
            item.group === TASK_MANAGEMENT_GROUP &&
            items[index + 1]?.group !== TASK_MANAGEMENT_GROUP;
          return (
            <React.Fragment key={item.key}>
              {showSeparator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={item.disabled}
                variant={item.variant}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onSelect();
                }}
                className="whitespace-nowrap"
              >
                <Icon className="size-4" />
                {item.label}
              </DropdownMenuItem>
              {showRestartAfter && actions.onRestartSession && (
                <RestartSessionDropdownSubmenu onRestart={actions.onRestartSession} />
              )}
            </React.Fragment>
          );
        })}
        {actions.onAssignWorkspace && (
          <TaskWorkspaceDropdownSubmenu
            currentWorkspaceId={actions.currentWorkspaceId ?? null}
            onAssign={actions.onAssignWorkspace}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
