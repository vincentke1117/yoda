import type { TFunction } from 'i18next';
import {
  Activity,
  Archive,
  ArchiveX,
  CircleDot,
  CircleSlash,
  Copy,
  FileText,
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
import React from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@renderer/lib/hooks/use-toast';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

interface TaskMenuActions {
  isPinned: boolean;
  canPin: boolean;
  isArchived: boolean;
  needsReview: boolean;
  canMarkReview: boolean;
  branchName?: string;
  sessionId?: string;
  projectPath?: string;
  resumeCommand?: string;
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
  onDelete: () => void;
  onRunScript?: () => void;
  canRunScript?: boolean;
  onConfigureScripts?: () => void;
  onViewStatus?: () => void;
}

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
      label: actions.openDetailsLabel ?? t('sidebar.openSessionDetails'),
      onSelect: actions.onOpenDetails,
    });
  }

  // group 1 — run scripts
  if (actions.onRunScript) {
    items.push({
      key: 'run-script',
      group: 1,
      icon: PlayCircle,
      label: t('sidebar.runScripts.runScript'),
      onSelect: actions.onRunScript,
      disabled: actions.canRunScript === false,
    });
  }
  if (actions.onViewStatus) {
    items.push({
      key: 'view-status',
      group: 1,
      icon: Activity,
      label: t('sidebar.runScripts.scriptStatus'),
      onSelect: actions.onViewStatus,
    });
  }
  if (actions.onConfigureScripts) {
    items.push({
      key: 'configure-scripts',
      group: 1,
      icon: Settings2,
      label: t('sidebar.runScripts.configure'),
      onSelect: actions.onConfigureScripts,
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

  // group 3 — archive / restore
  if (!actions.isArchived) {
    items.push({
      key: 'archive',
      group: 3,
      icon: Archive,
      label: t('sidebar.archiveTask'),
      onSelect: actions.onArchive,
    });
    if (actions.onArchiveSkipPreCommand) {
      items.push({
        key: 'archive-skip-pre',
        group: 3,
        icon: ArchiveX,
        label: t('sidebar.archiveTaskSkipPre'),
        onSelect: actions.onArchiveSkipPreCommand,
      });
    }
    if (actions.onArchiveWithNote) {
      items.push({
        key: 'archive-with-note',
        group: 3,
        icon: FileText,
        label: t('sidebar.archiveTaskWithNote'),
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

  // group 4 — utilities
  if (actions.branchName) {
    const branch = actions.branchName;
    items.push({
      key: 'copy-branch',
      group: 4,
      icon: Copy,
      label: t('tasks.context.copyBranchName'),
      onSelect: () => {
        void copyText(branch, t, {
          success: t('tasks.context.branchNameCopied'),
          failure: t('tasks.context.copyBranchNameFailed'),
        });
      },
    });
  }
  if (actions.sessionId) {
    const sessionId = actions.sessionId;
    items.push({
      key: 'copy-session-id',
      group: 4,
      icon: Copy,
      label: t('tasks.context.copySessionId'),
      onSelect: () => {
        void copyText(sessionId, t, {
          success: t('tasks.context.sessionIdCopied'),
          failure: t('tasks.context.copyFailed'),
        });
      },
    });
  }
  if (actions.projectPath) {
    const path = actions.projectPath;
    items.push({
      key: 'copy-project-path',
      group: 4,
      icon: Copy,
      label: t('tasks.context.copyProjectPath'),
      onSelect: () => {
        void copyText(path, t, {
          success: t('tasks.context.projectPathCopied'),
          failure: t('tasks.context.copyFailed'),
        });
      },
    });
  }
  if (actions.resumeCommand) {
    const cmd = actions.resumeCommand;
    items.push({
      key: 'copy-resume-command',
      group: 4,
      icon: Copy,
      label: t('tasks.context.copyResumeCommand'),
      onSelect: () => {
        void copyText(cmd, t, {
          success: t('tasks.context.resumeCommandCopied'),
          failure: t('tasks.context.copyFailed'),
        });
      },
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
            </React.Fragment>
          );
        })}
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
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
