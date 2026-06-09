import {
  AppWindow,
  Archive,
  ArchiveX,
  Copy,
  GitCompare,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Pin,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { buildTaskDeepLink } from '@shared/deep-links';
import { taskWindowDockHoverChannel, taskWindowDockRequestChannel } from '@shared/events/appEvents';
import type { TaskWindowBounds, TaskWindowTarget } from '@shared/task-window';
import { openProvisionedTaskTab } from '@renderer/app/open-task-target';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  archiveConversationWithPreCommand,
  archiveTaskIfNoConversationsLeft,
} from '@renderer/features/tasks/archive-task';
import { FileActionsMenuItems } from '@renderer/features/tasks/components/file-actions';
import { copyTaskLink } from '@renderer/features/tasks/components/task-context-menu';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { GitChangeStatusIcon } from '@renderer/features/tasks/diff-view/changes-panel/components/changes-list-item';
import type { ResolvedDiffTab, ResolvedTab } from '@renderer/features/tasks/tabs/tab-manager-store';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { splitPath } from '@renderer/features/tasks/utils';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { ReorderList } from '@renderer/lib/components/reorder-list';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
import { events, rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';

export const TaskTabStrip = observer(function TaskTabStrip() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { taskView } = provisioned;
  const { tabManager } = taskView;
  const tabs = tabManager.resolvedTabs;
  const activeTabId = tabManager.resolvedActiveTabId;
  const showCreateConversationModal = useShowModal('createConversationModal');
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const preArchiveCommand = homeDraft?.preArchiveCommand ?? '';
  const [isReturningWindowTab, setIsReturningWindowTab] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  // Tracks a tab being dragged out of the strip. `torn` flips true the moment
  // the pointer clears the strip, which floats a ghost preview under the cursor
  // and dims the source tab so the detach reads as already-decided mid-drag.
  // The real window is only spawned on release.
  const [detachDrag, setDetachDrag] = useState<{
    tabId: string;
    point: { x: number; y: number };
    torn: boolean;
  } | null>(null);
  const mountedProject = asMounted(getProjectStore(projectId));
  const connectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

  const tabIds = useMemo(() => tabs.map((tab) => tab.tabId), [tabs]);
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.tabId, tab])), [tabs]);

  // Dragging a tab clear of the strip detaches it into its own window — the
  // pointer-drag analogue of the right-click "Open in window" action. The
  // overview tab is fixed and cannot be detached.
  const isPointTornOut = (tab: ResolvedTab, point: { x: number; y: number }): boolean => {
    const strip = stripRef.current;
    if (!strip || tab.kind === 'overview') return false;
    const rect = strip.getBoundingClientRect();
    // Tear out the instant the pointer leaves the strip bounds. A small buffer
    // avoids jitter right at the edge while reordering horizontally.
    const margin = 4;
    return (
      point.y > rect.bottom + margin ||
      point.y < rect.top - margin ||
      point.x < rect.left - margin ||
      point.x > rect.right + margin
    );
  };

  const handleTabDrag = (tabId: string, point: { x: number; y: number }) => {
    const tab = tabsById.get(tabId);
    if (!tab || tab.kind === 'overview') return;
    setDetachDrag({ tabId, point, torn: isPointTornOut(tab, point) });
  };

  const handleTabDragEnd = (tabId: string, point: { x: number; y: number }) => {
    setDetachDrag(null);
    const tab = tabsById.get(tabId);
    if (!tab || tab.kind === 'overview') return;
    if (!isPointTornOut(tab, point)) return;
    void openTaskTabInWindow(buildTaskWindowTarget(projectId, taskId, tab), point).then(
      (opened) => {
        if (opened) tabManager.closeTab(tab.tabId);
      }
    );
  };

  const handleReorder = (newIds: string[]) => {
    for (let toIndex = 0; toIndex < newIds.length; toIndex++) {
      const fromIndex = tabIds.indexOf(newIds[toIndex]!);
      if (fromIndex === -1) continue;
      if (fromIndex !== toIndex) {
        tabManager.reorderTabs(fromIndex, toIndex);
        return;
      }
    }
  };

  const handleCreateConversation = () => {
    showCreateConversationModal({
      connectionId,
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => {
        tabManager.openConversation(conversationId);
        taskView.setFocusedRegion('main');
      },
    });
  };

  const handleArchiveConversation = (
    conversationId: string,
    options?: { skipPreCommand?: boolean }
  ) => {
    if (provisioned.conversations.conversations.get(conversationId)?.isArchiving) return;
    void (async () => {
      try {
        await archiveConversationWithPreCommand(projectId, taskId, conversationId, {
          preArchiveCommand,
          skipPreCommand: options?.skipPreCommand,
        });
        // Archiving the last conversation finishes the task — archive it too.
        await archiveTaskIfNoConversationsLeft(projectId, taskId);
      } catch (error) {
        log.warn('TaskTabStrip: archive conversation failed', {
          projectId,
          taskId,
          conversationId,
          error,
        });
      }
    })();
  };

  // Report the strip's rect (in window/content CSS pixels) to the main process
  // so it can detect when a detached task window is dragged over this drop zone.
  // The strip can scroll/resize, so re-measure on layout changes too.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const report = () => {
      const rect = strip.getBoundingClientRect();
      void rpc.app.setTaskStripDropZone({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(strip);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      void rpc.app.setTaskStripDropZone(null);
    };
  }, []);

  // Main process toggles this while a detached window hovers the strip.
  useEffect(() => {
    return events.on(taskWindowDockHoverChannel, ({ hovering }) => {
      setIsReturningWindowTab(hovering);
    });
  }, []);

  // Main process requests a dock once a detached window is released over the
  // strip: re-open the tab locally, then ack so the detached window closes.
  useEffect(() => {
    return events.on(taskWindowDockRequestChannel, (payload) => {
      setIsReturningWindowTab(false);
      if (payload.target.projectId !== projectId || payload.target.taskId !== taskId) return;
      void openProvisionedTaskTab(provisioned, payload.target.tab)
        .then(async (found) => {
          if (!found) return;
          const res = await rpc.app.notifyTaskWindowReturned(payload);
          if (!res?.success) showReturnTaskWindowFailure(res?.error);
        })
        .catch((error: unknown) => {
          showReturnTaskWindowFailure(error instanceof Error ? error.message : String(error));
        });
    });
  }, [projectId, taskId, provisioned]);

  return (
    <div
      ref={stripRef}
      className={cn(
        'flex h-9 shrink-0 items-stretch border-b border-border bg-background-secondary',
        isReturningWindowTab && 'ring-1 ring-inset ring-ring'
      )}
      role="tablist"
    >
      <div className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <ReorderList
          axis="x"
          items={tabIds}
          onReorder={handleReorder}
          onItemDrag={(tabId, _event, info) => handleTabDrag(tabId, info.point)}
          onItemDragEnd={(tabId, _event, info) => handleTabDragEnd(tabId, info.point)}
          className="flex h-full shrink-0"
          itemClassName="flex h-full shrink-0 list-none"
          getKey={(tabId) => tabId}
        >
          {(tabId) => {
            const tab = tabsById.get(tabId);
            if (!tab) return null;
            const index = tabIds.indexOf(tab.tabId);
            // Closeable tabs are every tab except the fixed overview tab.
            const closeableCount = tabs.filter((other) => other.kind !== 'overview').length;
            const canCloseOthers = tab.kind !== 'overview' && closeableCount > 1;
            const canCloseToRight = index >= 0 && index < tabIds.length - 1;
            const tabPath = tab.kind === 'file' || tab.kind === 'diff' ? tab.path : undefined;
            const absolutePath = tabPath
              ? `${provisioned.path.replace(/\/+$/, '')}/${tabPath}`
              : undefined;
            return (
              <TaskTab
                tab={tab}
                isActive={activeTabId === tab.tabId}
                isDetaching={detachDrag?.torn === true && detachDrag.tabId === tab.tabId}
                fileSourcePath={absolutePath}
                closeLabel={t('tasks.tabs.close')}
                previewLabel={t('tasks.tabs.preview')}
                onSelect={() => {
                  taskView.setFocusedRegion('main');
                  tabManager.setActiveTab(tab.tabId);
                }}
                onClose={() => tabManager.closeTab(tab.tabId)}
                onPin={() => tabManager.pinTab(tab.tabId)}
                onCloseOthers={
                  canCloseOthers ? () => tabManager.closeOtherTabs(tab.tabId) : undefined
                }
                onCloseToRight={
                  canCloseToRight ? () => tabManager.closeTabsToRight(tab.tabId) : undefined
                }
                onCloseAll={closeableCount > 0 ? () => tabManager.closeAllTabs() : undefined}
                onOpenInWindow={
                  tab.kind === 'overview'
                    ? undefined
                    : () => {
                        void openTaskTabInWindow(
                          buildTaskWindowTarget(projectId, taskId, tab)
                        ).then((opened) => {
                          if (opened) tabManager.closeTab(tab.tabId);
                        });
                      }
                }
                onReloadConversation={
                  tab.kind === 'conversation'
                    ? () => void provisioned.conversations.restartConversation(tab.conversationId)
                    : undefined
                }
                archiveLabel={t('tasks.tabs.archiveConversation')}
                archiveSkipPreLabel={t('tasks.tabs.archiveConversationSkipPre')}
                isArchiving={
                  tab.kind === 'conversation' &&
                  (provisioned.conversations.conversations.get(tab.conversationId)?.isArchiving ??
                    false)
                }
                hasPreArchiveCommand={preArchiveCommand.trim().length > 0}
                onArchiveConversation={
                  tab.kind === 'conversation'
                    ? (options) => handleArchiveConversation(tab.conversationId, options)
                    : undefined
                }
                onCopyYodaLink={
                  tab.kind === 'conversation'
                    ? () =>
                        void copyTaskLink(
                          buildTaskDeepLink({
                            projectId,
                            taskId,
                            conversationId: tab.conversationId,
                          }),
                          t
                        )
                    : undefined
                }
              />
            );
          }}
        </ReorderList>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t('tasks.tabs.newConversation')}
                className="flex w-9 shrink-0 items-center justify-center border-r border-border text-foreground-passive outline-none transition-colors hover:bg-background-secondary-1/70 hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={handleCreateConversation}
              >
                <Plus className="size-4" />
              </button>
            }
          />
          <TooltipContent>{t('tasks.tabs.newConversation')}</TooltipContent>
        </Tooltip>
      </div>
      {detachDrag?.torn === true &&
        (() => {
          const tab = tabsById.get(detachDrag.tabId);
          if (!tab) return null;
          return <TabDetachGhost tab={tab} point={detachDrag.point} />;
        })()}
    </div>
  );
});

// Floats under the cursor once a tab has been torn out of the strip, so the
// detach reads as already-committed before release. Spawning the real window
// mid-drag would fight the OS pointer capture, so this is a renderer preview.
function TabDetachGhost({ tab, point }: { tab: ResolvedTab; point: { x: number; y: number } }) {
  const meta = getTabMeta(tab);
  return createPortal(
    <div
      className="pointer-events-none fixed z-50 flex max-w-56 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground shadow-lg"
      style={{ left: point.x + 12, top: point.y + 12 }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{meta.icon}</span>
      <span className="min-w-0 truncate">{meta.label}</span>
    </div>,
    document.body
  );
}

const TaskTab = observer(function TaskTab({
  tab,
  isActive,
  isDetaching,
  fileSourcePath,
  closeLabel,
  previewLabel,
  archiveLabel,
  archiveSkipPreLabel,
  isArchiving,
  hasPreArchiveCommand,
  onSelect,
  onClose,
  onPin,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onOpenInWindow,
  onReloadConversation,
  onArchiveConversation,
  onCopyYodaLink,
}: {
  tab: ResolvedTab;
  isActive: boolean;
  /** True while this tab has been dragged clear of the strip and will detach on release. */
  isDetaching: boolean;
  /** Absolute path of the file/diff this tab targets, for file-action items. */
  fileSourcePath?: string;
  closeLabel: string;
  previewLabel: string;
  archiveLabel: string;
  archiveSkipPreLabel: string;
  isArchiving: boolean;
  hasPreArchiveCommand: boolean;
  onSelect: () => void;
  onClose: () => void;
  onPin: () => void;
  onCloseOthers?: () => void;
  onCloseToRight?: () => void;
  onCloseAll?: () => void;
  onOpenInWindow?: () => void;
  onReloadConversation?: () => void;
  onArchiveConversation?: (options?: { skipPreCommand?: boolean }) => void;
  onCopyYodaLink?: () => void;
}) {
  const meta = getTabMeta(tab);
  const title = tab.isPreview ? `${meta.title} (${previewLabel})` : meta.title;

  const tabContent = (
    <div
      className={cn(
        'group/tab relative flex h-full w-fit max-w-56 items-stretch border-r border-border text-foreground-muted',
        'bg-background-secondary hover:bg-background-secondary-1/70',
        isActive && 'bg-background text-foreground hover:bg-background',
        isArchiving && 'text-foreground/40',
        isDetaching && 'opacity-40'
      )}
    >
      {isActive && <div className="absolute inset-x-0 top-0 h-0.5 bg-foreground" />}
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        title={title}
        onClick={onSelect}
        onDoubleClick={() => {
          if (tab.isPreview) onPin();
        }}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">{meta.icon}</span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span
            className={cn(
              'min-w-0 truncate text-xs leading-none',
              tab.isPreview && 'italic text-foreground-muted'
            )}
          >
            {meta.label}
          </span>
          {meta.detail && (
            <span className="min-w-0 truncate text-[10px] leading-none text-foreground-passive">
              {meta.detail}
            </span>
          )}
        </span>
        {tab.kind === 'file' && tab.isDirty && (
          <span className="size-1.5 shrink-0 rounded-full bg-foreground-muted" />
        )}
      </button>
      {isArchiving && (
        <span className="flex size-6 shrink-0 self-center text-foreground-passive">
          <Loader2 className="m-auto size-3.5 animate-spin" />
        </span>
      )}
      {/* The fixed overview tab cannot be closed, so it has no close button. */}
      {tab.kind !== 'overview' && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={closeLabel}
                className={cn(
                  'flex h-6 w-0 shrink-0 self-center overflow-hidden rounded-md text-foreground-passive opacity-0 outline-none transition-all hover:bg-background-2 hover:text-foreground focus-visible:w-6 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover/tab:mr-1 group-hover/tab:w-6 group-hover/tab:opacity-100 group-focus-within/tab:mr-1 group-focus-within/tab:w-6 group-focus-within/tab:opacity-100',
                  isArchiving && 'hidden'
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
              >
                <X className="m-auto size-3.5" />
              </button>
            }
          />
          <TooltipContent>{closeLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  const isCloseable = tab.kind !== 'overview';
  const isPreview = tab.kind !== 'overview' && tab.isPreview;
  const hasCloseActions =
    isCloseable || Boolean(onCloseOthers) || Boolean(onCloseToRight) || Boolean(onCloseAll);
  const menuGroups: { key: string; content: ReactNode }[] = [];

  if (isPreview) {
    menuGroups.push({
      key: 'pin',
      content: (
        <ContextMenuItem className="whitespace-nowrap" onClick={onPin}>
          <Pin className="size-4" />
          {i18n.t('tasks.tabs.pin')}
        </ContextMenuItem>
      ),
    });
  }

  if (onOpenInWindow) {
    menuGroups.push({
      key: 'open-in-window',
      content: (
        <ContextMenuItem className="whitespace-nowrap" onClick={onOpenInWindow}>
          <AppWindow className="size-4" />
          {i18n.t('tasks.tabs.openInWindow')}
        </ContextMenuItem>
      ),
    });
  }

  if (fileSourcePath) {
    menuGroups.push({
      key: 'file-actions',
      content: <FileActionsMenuItems sourcePath={fileSourcePath} kind="file" />,
    });
  }

  if (onCopyYodaLink) {
    menuGroups.push({
      key: 'copy-yoda-link',
      content: (
        <ContextMenuItem className="whitespace-nowrap" onClick={onCopyYodaLink}>
          <Copy className="size-4" />
          {i18n.t('tasks.tabs.copyYodaLink')}
        </ContextMenuItem>
      ),
    });
  }

  if (onArchiveConversation) {
    menuGroups.push({
      key: 'archive-conversation',
      content: (
        <>
          <ContextMenuItem
            className="whitespace-nowrap"
            onClick={() => onArchiveConversation()}
            disabled={isArchiving}
          >
            {isArchiving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Archive className="size-4" />
            )}
            {archiveLabel}
          </ContextMenuItem>
          {hasPreArchiveCommand && (
            <ContextMenuItem
              className="whitespace-nowrap"
              onClick={() => onArchiveConversation({ skipPreCommand: true })}
              disabled={isArchiving}
            >
              <ArchiveX className="size-4" />
              {archiveSkipPreLabel}
            </ContextMenuItem>
          )}
        </>
      ),
    });
  }

  if (onReloadConversation) {
    menuGroups.push({
      key: 'reload-conversation',
      content: (
        <ContextMenuItem
          className="whitespace-nowrap"
          onClick={onReloadConversation}
          disabled={isArchiving}
        >
          <RefreshCw className="size-4" />
          {i18n.t('tasks.tabs.reloadConversation')}
        </ContextMenuItem>
      ),
    });
  }

  if (hasCloseActions) {
    menuGroups.push({
      key: 'close-tabs',
      content: (
        <>
          {isCloseable && (
            <ContextMenuItem className="whitespace-nowrap" onClick={onClose}>
              <X className="size-4" />
              {closeLabel}
            </ContextMenuItem>
          )}
          {onCloseOthers && (
            <ContextMenuItem className="whitespace-nowrap" onClick={onCloseOthers}>
              <X className="size-4" />
              {i18n.t('tasks.tabs.closeOthers')}
            </ContextMenuItem>
          )}
          {onCloseToRight && (
            <ContextMenuItem className="whitespace-nowrap" onClick={onCloseToRight}>
              <X className="size-4" />
              {i18n.t('tasks.tabs.closeToRight')}
            </ContextMenuItem>
          )}
          {onCloseAll && (
            <ContextMenuItem className="whitespace-nowrap" onClick={onCloseAll}>
              <X className="size-4" />
              {i18n.t('tasks.tabs.closeAll')}
            </ContextMenuItem>
          )}
        </>
      ),
    });
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-full shrink-0">{tabContent}</ContextMenuTrigger>
      <ContextMenuContent className="w-max overflow-x-visible">
        {menuGroups.map((group, index) => (
          <Fragment key={group.key}>
            {index > 0 && <ContextMenuSeparator />}
            {group.content}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});

function getTabMeta(tab: ResolvedTab): {
  icon: ReactNode;
  label: string;
  detail?: string;
  title: string;
} {
  if (tab.kind === 'overview') {
    const label = i18n.t('tasks.tabs.overview');
    return { icon: <LayoutDashboard className="size-3.5" />, label, title: label };
  }

  if (tab.kind === 'conversation') {
    const providerId = tab.store.data.providerId;
    const config = agentConfig[providerId];
    const label =
      formatConversationTitleForDisplay(providerId, tab.store.data.title).trim() ||
      config?.name ||
      providerId;
    return {
      icon: config ? (
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="size-3.5"
        />
      ) : (
        <MessageSquare className="size-3.5" />
      ),
      label,
      title: label,
    };
  }

  const { filename, directory } = splitPath(tab.path);
  if (tab.kind === 'file') {
    return {
      icon: <FileIcon filename={filename} size={13} />,
      label: filename,
      detail: directory,
      title: tab.path,
    };
  }

  return {
    icon: tab.status ? (
      <GitChangeStatusIcon status={tab.status} className="size-3.5" />
    ) : (
      <GitCompare className="size-3.5 text-foreground-passive" />
    ),
    label: filename,
    detail: directory || diffGroupLabel(tab.diffGroup),
    title: tab.path,
  };
}

function diffGroupLabel(group: ResolvedDiffTab['diffGroup']): string {
  switch (group) {
    case 'disk':
      return 'Changed';
    case 'staged':
      return 'Staged';
    case 'pr':
      return 'PR';
    case 'git':
      return 'Git';
  }
}

function buildTaskWindowTarget(
  projectId: string,
  taskId: string,
  tab: ResolvedTab
): TaskWindowTarget {
  const base = { projectId, taskId };
  switch (tab.kind) {
    case 'overview':
      return { ...base, tab: { kind: 'overview' } };
    case 'conversation':
      return { ...base, tab: { kind: 'conversation', conversationId: tab.conversationId } };
    case 'file':
      return { ...base, tab: { kind: 'file', path: tab.path } };
    case 'diff':
      return {
        ...base,
        tab: {
          kind: 'diff',
          path: tab.path,
          diffGroup: tab.diffGroup,
          originalRef: tab.originalRef,
          modifiedRef: tab.modifiedRef,
          prNumber: tab.prNumber,
          status: tab.status,
        },
      };
  }
}

async function openTaskTabInWindow(
  target: TaskWindowTarget,
  origin?: { x: number; y: number }
): Promise<boolean> {
  try {
    const res = await rpc.app.openTaskWindow(withMeasuredTaskWindowBounds(target, origin));
    if (!res?.success) {
      showOpenTaskWindowFailure(res?.error);
      return false;
    }
    return true;
  } catch (error) {
    showOpenTaskWindowFailure(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function withMeasuredTaskWindowBounds(
  target: TaskWindowTarget,
  origin?: { x: number; y: number }
): TaskWindowTarget {
  const measured = measureTaskWindowBounds();
  const originPoint = origin ? { x: Math.round(origin.x), y: Math.round(origin.y) } : undefined;
  if (!measured && !originPoint) return target;
  // Spawn-at-cursor only needs `origin`; the main process reads the live cursor.
  // Fall back to default size when the active content can't be measured.
  const bounds: TaskWindowBounds = {
    width: measured?.width ?? 920,
    height: measured?.height ?? 640,
    ...(originPoint ? { origin: originPoint } : {}),
  };
  return { ...target, bounds };
}

function measureTaskWindowBounds(): TaskWindowBounds | undefined {
  const source = document.querySelector<HTMLElement>('[data-task-active-tab-content]');
  const rect = source?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height + 28),
  };
}

function showOpenTaskWindowFailure(description?: string): void {
  toast({
    title: i18n.t('tasks.tabs.openInWindowFailed'),
    description,
    variant: 'destructive',
  });
}

function showReturnTaskWindowFailure(description?: string): void {
  toast({
    title: i18n.t('tasks.tabs.returnFromWindowFailed'),
    description,
    variant: 'destructive',
  });
}
