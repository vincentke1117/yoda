import type { TFunction } from 'i18next';
import {
  AppWindow,
  ArrowRightToLine,
  CopyX,
  ListX,
  LocateFixed,
  PanelRight,
  PanelRightOpen,
  RefreshCw,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskWindowTabTarget } from '@shared/task-window';
import {
  closeTaskTopTab,
  findInternalTabId,
  openProvisionedTaskTab,
} from '@renderer/app/open-task-target';
import { refreshProjectFile } from '@renderer/features/project-file/project-file-session';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { TaskContextMenuItems } from '@renderer/features/tasks/components/task-context-menu';
import { useTaskMenuActions } from '@renderer/features/tasks/components/use-task-menu-actions';
import { isUnprovisioned, type ProvisionedTask } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { type TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import { openTaskTabInWindow } from '@renderer/features/tasks/tabs/tab-meta';
import { FilePathMenuItems, type FilePathTarget } from '@renderer/lib/components/file-path-actions';
import { APP_SHORTCUTS } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import { isIndexTab, type AppTabEntry } from '@renderer/lib/stores/app-tabs-store';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';

/** Right-click menu for top-level app tabs; sections are separated automatically. */
export const AppTabContextMenu = observer(function AppTabContextMenu({
  tab,
  children,
}: {
  tab: AppTabEntry;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setCollapsed } = useWorkspaceLayoutContext();
  const revealInSidebar = () => revealTabInSidebar(tab, () => setCollapsed('left', false));

  // A task tab IS the task entity on the strip, and so is its session tab (a
  // task is its session) — both get the shared task menu, identical to the
  // sidebar row and the kanban row.
  if (tab.viewId === 'task') {
    const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
    const target = tab.params.tab as TaskWindowTabTarget | undefined;
    if (projectId && taskId && (target === undefined || target.kind === 'conversation')) {
      return (
        <TaskOverviewTabMenu
          tab={tab}
          projectId={projectId}
          taskId={taskId}
          target={target}
          onRevealInSidebar={revealInSidebar}
        >
          {children}
        </TaskOverviewTabMenu>
      );
    }
  }

  const sections = buildTabSections(tab, t, revealInSidebar).filter(
    (section) => section.length > 0
  );

  if (sections.length === 0) return <>{children}</>;

  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {sections.map((section, index) => (
          // Sections are stable per tab kind — index keys are fine here.
          <Fragment key={index}>
            {index > 0 ? <ContextMenuSeparator /> : null}
            {section}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});

export type Translate = TFunction;

function buildTabSections(
  tab: AppTabEntry,
  t: Translate,
  onRevealInSidebar: () => void
): ReactNode[][] {
  const reveal = buildRevealInSidebarSection(tab, t, onRevealInSidebar);
  if (tab.viewId === 'task') return buildTaskSections(tab, t, reveal);
  if (tab.viewId === 'file') {
    return [
      [...reveal, buildGlobalPinItem(tab, t)],
      buildProjectFileSection(tab),
      buildCloseSection(tab, t),
    ];
  }
  // Every other tab (project pages, global views, home) can at least be
  // pinned into the shell side pane.
  return [[...reveal, buildGlobalPinItem(tab, t)], buildCloseSection(tab, t)];
}

export function tabSidebarTarget(
  tab: AppTabEntry
): { projectId: string; taskId?: string } | undefined {
  const { projectId, taskId } = tab.params as { projectId?: unknown; taskId?: unknown };
  if (typeof projectId !== 'string' || projectId.length === 0) return undefined;
  if (tab.viewId === 'task') {
    if (typeof taskId !== 'string' || taskId.length === 0) return undefined;
    return { projectId, taskId };
  }
  if (tab.viewId === 'project' || tab.viewId === 'file') return { projectId };
  return undefined;
}

export function revealTabInSidebar(tab: AppTabEntry, revealSidebar: () => void): void {
  const target = tabSidebarTarget(tab);
  if (!target) return;
  revealSidebar();
  sidebarStore.requestSelectionReveal(target.projectId, target.taskId);
}

function buildRevealInSidebarSection(
  tab: AppTabEntry,
  t: Translate,
  onRevealInSidebar: () => void
): ReactNode[] {
  if (!tabSidebarTarget(tab)) return [];
  return [
    <ContextMenuItem
      key="reveal-in-sidebar"
      className="whitespace-nowrap"
      onClick={onRevealInSidebar}
    >
      <LocateFixed className="size-4" />
      {t('appTabs.revealInSidebar')}
    </ContextMenuItem>,
  ];
}

/** "Open in global sidebar" — pane gets an independent view instance; tab stays. */
function buildGlobalPinItem(tab: AppTabEntry, t: Translate): ReactNode {
  return (
    <ContextMenuItem
      key="global-pin"
      className="whitespace-nowrap"
      onClick={() => appState.sidePane.pinView(tab.viewId, tab.params)}
    >
      <PanelRightOpen className="size-4" />
      {t('appTabs.openInGlobalSidePane')}
    </ContextMenuItem>
  );
}

// ---------------------------------------------------------------------------
// Task tabs (sessions, worktree files, diffs)
// ---------------------------------------------------------------------------

/** Overview tab menu — reuses shared task items (see agents/conventions/reuse.md). */
const TaskOverviewTabMenu = observer(function TaskOverviewTabMenu({
  tab,
  projectId,
  taskId,
  target,
  onRevealInSidebar,
  children,
}: {
  tab: AppTabEntry;
  projectId: string;
  taskId: string;
  /** Set for the task's session tab; absent for the task tab itself. */
  target?: TaskWindowTabTarget;
  onRevealInSidebar: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const actions = useTaskMenuActions(projectId, taskId);
  const reveal = (
    <ContextMenuItem
      key="reveal-in-sidebar"
      className="whitespace-nowrap"
      onClick={onRevealInSidebar}
    >
      <LocateFixed className="size-4" />
      {t('appTabs.revealInSidebar')}
    </ContextMenuItem>
  );
  // A session tab can move (side pane / shell pane / window); the task tab
  // itself only spawns an independent view instance in the shell pane.
  const placement = target
    ? buildTargetPlacementItems(tab, projectId, taskId, target, t)
    : [
        <ContextMenuItem
          key="global-pin"
          className="whitespace-nowrap"
          onClick={() => appState.sidePane.pinTaskView(projectId, taskId)}
        >
          <PanelRightOpen className="size-4" />
          {t('appTabs.openInGlobalSidePane')}
        </ContextMenuItem>,
      ];
  const tabSections: ReactNode[][] = [
    buildProvisionRetrySection(projectId, taskId, t),
    [reveal, ...placement],
    buildCloseSection(tab, t),
  ].filter((section) => section.length > 0);

  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-max overflow-x-visible">
        {actions ? (
          <>
            <TaskContextMenuItems {...actions} />
            <ContextMenuSeparator />
          </>
        ) : null}
        {tabSections.map((section, index) => (
          // Sections are stable per tab kind — index keys are fine here.
          <Fragment key={index}>
            {index > 0 ? <ContextMenuSeparator /> : null}
            {section}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});

function buildTaskSections(tab: AppTabEntry, t: Translate, reveal: ReactNode[]): ReactNode[][] {
  const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
  const target = tab.params.tab as TaskWindowTabTarget | undefined;
  // The task's own tab and its session tab are intercepted by
  // TaskOverviewTabMenu before reaching here.
  if (!projectId || !taskId || !target) return [];

  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  const retry = buildProvisionRetrySection(projectId, taskId, t);
  const placement = buildTargetPlacementItems(tab, projectId, taskId, target, t);

  // room-member target — identity tab; placement + close only (no path actions).
  // A conversation target never reaches here (TaskOverviewTabMenu owns it), but
  // it still has to be narrowed away before the path-based items below.
  if (target.kind === 'room-member' || target.kind === 'conversation') {
    return [retry, [...reveal, ...placement], buildCloseSection(tab, t)];
  }

  // file / diff target — path actions based on the task worktree.
  const file: ReactNode[] = provisioned
    ? [
        <FilePathMenuItems
          key="file-actions"
          target={fileTarget(provisioned.path, target.path, provisioned.workspace.sshConnectionId)}
          components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
          onRefresh={
            target.kind === 'file'
              ? () => provisioned.taskView.editorView.refreshFile(target.path)
              : undefined
          }
        />,
      ]
    : [];

  return [retry, [...reveal, ...placement], file, buildCloseSection(tab, t)];
}

/** Where a task-entity tab can go: task sidebar, shell side pane, own window. */
function buildTargetPlacementItems(
  tab: AppTabEntry,
  projectId: string,
  taskId: string,
  target: TaskWindowTabTarget,
  t: Translate
): ReactNode[] {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  const items: ReactNode[] = [];
  if (provisioned) {
    items.push(
      <ContextMenuItem
        key="sidebar-pin"
        className="whitespace-nowrap"
        onClick={() => void moveTopTabToSidebar(tab, provisioned, target)}
      >
        <PanelRight className="size-4" />
        {t('tasks.tabs.openInSidePane')}
      </ContextMenuItem>,
      <ContextMenuItem
        key="global-pin"
        className="whitespace-nowrap"
        onClick={() => void moveTopTabToShellPane(tab, provisioned, projectId, taskId, target)}
      >
        <PanelRightOpen className="size-4" />
        {t('appTabs.openInGlobalSidePane')}
      </ContextMenuItem>
    );
  }
  items.push(
    <ContextMenuItem
      key="window"
      className="whitespace-nowrap"
      onClick={() => {
        void openTaskTabInWindow({ projectId, taskId, tab: target }).then((opened) => {
          if (opened) closeTaskTopTab(tab);
        });
      }}
    >
      <AppWindow className="size-4" />
      {t('tasks.tabs.openInWindow')}
    </ContextMenuItem>
  );
  return items;
}

/**
 * "Retry setup" item for a task stuck in `provision-error` — its workspace
 * never provisioned, so the conversation-management items (which require a
 * provisioned task) are absent. Re-runs `provisionTask`, mirroring the retry
 * button on the in-panel TaskProvisionRecovery surface.
 */
function buildProvisionRetrySection(projectId: string, taskId: string, t: Translate): ReactNode[] {
  const store = getTaskStore(projectId, taskId);
  if (!store || !isUnprovisioned(store) || store.phase !== 'provision-error') return [];
  return [
    <ContextMenuItem
      key="retry-provision"
      className="whitespace-nowrap"
      onClick={() => void getTaskManagerStore(projectId)?.provisionTask(taskId)}
    >
      <RefreshCw className="size-4" />
      {t('tasks.retryTaskSetup')}
    </ContextMenuItem>,
  ];
}

/** Scope-wide close actions; items appear only when they have a target. */
function buildCloseSection(tab: AppTabEntry, t: Translate): ReactNode[] {
  const visible = appState.appTabs.visibleTabs;
  const index = visible.findIndex((entry) => entry.id === tab.id);
  const closeable = visible.filter((entry) => !isIndexTab(entry));
  const others = closeable.filter((entry) => entry.id !== tab.id);
  const toRight =
    index === -1 ? [] : visible.slice(index + 1).filter((entry) => !isIndexTab(entry));

  const closeHotkey =
    tab.id === appState.appTabs.activeTabId
      ? formatHotkey(APP_SHORTCUTS.tabClose.defaultHotkey)
      : undefined;

  const items: ReactNode[] = [];
  if (!isIndexTab(tab)) {
    items.push(
      <ContextMenuItem
        key="close"
        className="whitespace-nowrap"
        onClick={() => closeTaskTopTab(tab)}
      >
        <X className="size-4" />
        {t('tasks.tabs.close')}
        {closeHotkey ? <ContextMenuShortcut>{closeHotkey}</ContextMenuShortcut> : null}
      </ContextMenuItem>
    );
  }
  if (others.length > 0) {
    items.push(
      <ContextMenuItem
        key="close-others"
        className="whitespace-nowrap"
        onClick={() => others.forEach(closeTaskTopTab)}
      >
        <ListX className="size-4" />
        {t('tasks.tabs.closeOthers')}
      </ContextMenuItem>
    );
  }
  if (toRight.length > 0) {
    items.push(
      <ContextMenuItem
        key="close-right"
        className="whitespace-nowrap"
        onClick={() => toRight.forEach(closeTaskTopTab)}
      >
        <ArrowRightToLine className="size-4" />
        {t('tasks.tabs.closeToRight')}
      </ContextMenuItem>
    );
  }
  if (closeable.length > 1) {
    items.push(
      <ContextMenuItem
        key="close-all"
        className="whitespace-nowrap"
        onClick={() => closeable.forEach(closeTaskTopTab)}
      >
        <CopyX className="size-4" />
        {t('tasks.tabs.closeAll')}
      </ContextMenuItem>
    );
  }
  return items;
}

/** 'Mod+W' → '⌘W', matching the command palette's hotkey display. */
function formatHotkey(hotkey: string | undefined): string | undefined {
  return hotkey?.replace('Mod', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace(/\+/g, '');
}

/** Move a top-level tab into the task sidebar; returns the new internal tab id. */
export async function moveTopTabToSidebar(
  tab: AppTabEntry,
  provisioned: ProvisionedTask,
  target: TaskWindowTabTarget
): Promise<string | undefined> {
  const tabManager = provisioned.taskView.tabManager;
  const internalId = await ensureInternalTab(provisioned, tabManager, target);
  if (!internalId) return undefined;

  tabManager.moveTabToSidebar(internalId);
  // Pinning while the sidebar is hidden would silently swallow the tab.
  provisioned.taskView.setSidebarCollapsed(false);
  appState.appTabs.closeTab(tab.id);
  return internalId;
}

/** Move a top-level tab into the cross-route shell side pane. */
export async function moveTopTabToShellPane(
  tab: AppTabEntry,
  provisioned: ProvisionedTask,
  projectId: string,
  taskId: string,
  target: TaskWindowTabTarget
): Promise<string | undefined> {
  const tabManager = provisioned.taskView.tabManager;
  const internalId = await ensureInternalTab(provisioned, tabManager, target);
  if (!internalId) return undefined;

  tabManager.moveTabToShellPin(internalId);
  appState.sidePane.pinTask(projectId, taskId, internalId);
  appState.appTabs.closeTab(tab.id);
  return internalId;
}

/** Ensures the internal tab entry exists for a target and returns its id. */
async function ensureInternalTab(
  provisioned: ProvisionedTask,
  tabManager: TabManagerStore,
  target: TaskWindowTabTarget
): Promise<string | undefined> {
  let internalId = findInternalTabId(tabManager, target);
  if (!internalId) {
    const bridge = tabManager.topLevelBridge;
    const key = JSON.stringify(target);
    const token = Symbol(key);
    if (bridge) bridge.applying = { key, token };
    try {
      await openProvisionedTaskTab(provisioned, target);
    } finally {
      if (bridge?.applying?.token === token) bridge.applying = null;
    }
    internalId = findInternalTabId(tabManager, target);
  }
  return internalId;
}

// ---------------------------------------------------------------------------
// Project-root file tabs
// ---------------------------------------------------------------------------

function buildProjectFileSection(tab: AppTabEntry): ReactNode[] {
  const { projectId, filePath } = tab.params as { projectId?: string; filePath?: string };
  if (!filePath) return [];
  // Project-less (agent-home) file tab — the path itself is absolute.
  if (!projectId) {
    return [
      <FilePathMenuItems
        key="file-actions"
        target={{ absolutePath: filePath, kind: 'file' }}
        components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
        onRefresh={() => refreshProjectFile(null, filePath)}
      />,
    ];
  }
  const project = getProjectStore(projectId);
  const data = project && 'data' in project ? project.data : undefined;
  if (!data || typeof data !== 'object' || !('path' in data)) return [];

  const sshConnectionId =
    'type' in data && data.type === 'ssh' && 'connectionId' in data
      ? ((data.connectionId as string | undefined) ?? null)
      : null;

  return [
    <FilePathMenuItems
      key="file-actions"
      target={fileTarget(String(data.path), filePath, sshConnectionId)}
      components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
      onRefresh={() => refreshProjectFile(projectId, filePath)}
    />,
  ];
}

export function fileTarget(
  rootPath: string,
  relativePath: string,
  sshConnectionId: string | null | undefined
): FilePathTarget {
  const separator = rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/';
  const absolutePath = `${rootPath.replace(/[\\/]+$/, '')}${separator}${relativePath
    .replace(/^\/+/, '')
    .replace(/\//g, separator)}`;
  return {
    absolutePath,
    relativePath,
    kind: 'file',
    sshConnectionId: sshConnectionId ?? null,
  };
}
