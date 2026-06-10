import { AppWindow, Archive, Link, PanelRight, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { buildTaskDeepLink } from '@shared/deep-links';
import type { TaskWindowTabTarget } from '@shared/task-window';
import {
  closeTaskTopTab,
  findInternalTabId,
  openProvisionedTaskTab,
} from '@renderer/app/open-task-target';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  archiveConversationWithPreCommand,
  archiveTaskIfNoConversationsLeft,
} from '@renderer/features/tasks/archive-task';
import { copyTaskLink } from '@renderer/features/tasks/components/task-context-menu';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { openTaskTabInWindow } from '@renderer/features/tasks/tabs/task-tab-strip';
import { FilePathMenuItems, type FilePathTarget } from '@renderer/lib/components/file-path-actions';
import { appState } from '@renderer/lib/stores/app-state';
import type { AppTabEntry } from '@renderer/lib/stores/app-tabs-store';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { log } from '@renderer/utils/logger';

/**
 * Right-click menu for top-level app tabs, built as sections separated
 * automatically:
 *
 *   1. placement   — open in side pane / open in window
 *   2. actions     — reload session, copy Yoda link
 *   3. archive     — archive session (+ skip-pre variant)
 *   4. file        — path actions for file/diff tabs
 *   5. close group — close / close others / close right / close all (scope-wide)
 */
export const AppTabContextMenu = observer(function AppTabContextMenu({
  tab,
  children,
}: {
  tab: AppTabEntry;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const preArchiveCommand = homeDraft?.preArchiveCommand ?? '';

  const sections = buildTabSections(tab, preArchiveCommand, t).filter(
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

type Translate = Parameters<typeof copyTaskLink>[1];

function buildTabSections(
  tab: AppTabEntry,
  preArchiveCommand: string,
  t: Translate
): ReactNode[][] {
  if (tab.viewId === 'task') return buildTaskSections(tab, preArchiveCommand, t);
  if (tab.viewId === 'file') return [buildProjectFileSection(tab)];
  return [];
}

// ---------------------------------------------------------------------------
// Task tabs (sessions, worktree files, diffs)
// ---------------------------------------------------------------------------

function buildTaskSections(
  tab: AppTabEntry,
  preArchiveCommand: string,
  t: Translate
): ReactNode[][] {
  const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
  const target = (tab.params.tab as TaskWindowTabTarget | undefined) ?? { kind: 'overview' };
  if (!projectId || !taskId || target.kind === 'overview') return [];

  const provisioned = asProvisioned(getTaskStore(projectId, taskId));

  const placement: ReactNode[] = [];
  if (provisioned) {
    placement.push(
      <ContextMenuItem
        key="side-pane"
        className="whitespace-nowrap"
        onClick={() => void moveTopTabToSidePane(tab, provisioned, target)}
      >
        <PanelRight className="size-4" />
        {t('tasks.tabs.openInSidePane')}
      </ContextMenuItem>
    );
  }
  placement.push(
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

  if (target.kind === 'conversation') {
    const conversationId = target.conversationId;

    const actions: ReactNode[] = [];
    if (provisioned) {
      actions.push(
        <ContextMenuItem
          key="reload"
          className="whitespace-nowrap"
          onClick={() => void provisioned.conversations.restartConversation(conversationId)}
        >
          <RefreshCw className="size-4" />
          {t('tasks.tabs.reloadConversation')}
        </ContextMenuItem>
      );
    }
    actions.push(
      <ContextMenuItem
        key="copy-link"
        className="whitespace-nowrap"
        onClick={() =>
          void copyTaskLink(buildTaskDeepLink({ projectId, taskId, conversationId }), t)
        }
      >
        <Link className="size-4" />
        {t('tasks.tabs.copyYodaLink')}
      </ContextMenuItem>
    );

    const archive: ReactNode[] = [];
    if (provisioned) {
      // Archiving always runs the configured pre-archive command (when set) —
      // the plain close (×) is the no-command path.
      const archiveConversation = () => {
        if (provisioned.conversations.conversations.get(conversationId)?.isArchiving) return;
        void (async () => {
          try {
            await archiveConversationWithPreCommand(projectId, taskId, conversationId, {
              preArchiveCommand,
            });
            await archiveTaskIfNoConversationsLeft(projectId, taskId);
          } catch (error) {
            log.warn('AppTabContextMenu: archive conversation failed', {
              projectId,
              taskId,
              conversationId,
              error,
            });
          }
        })();
      };
      archive.push(
        <ContextMenuItem key="archive" className="whitespace-nowrap" onClick={archiveConversation}>
          <Archive className="size-4" />
          {t('tasks.tabs.archiveConversation')}
        </ContextMenuItem>
      );
    }

    return [placement, actions, archive];
  }

  // file / diff target — path actions based on the task worktree.
  const file: ReactNode[] = provisioned
    ? [
        <FilePathMenuItems
          key="file-actions"
          target={fileTarget(provisioned.path, target.path, provisioned.workspace.sshConnectionId)}
          components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
        />,
      ]
    : [];

  return [placement, file];
}

/**
 * Moves a top-level task tab into the task's right side pane: ensures the
 * internal tab entry exists (replaying the target below the bridge), hands it
 * to the side pane, then closes the top-level tab — the entity now lives in
 * the pane, not the strip.
 */
async function moveTopTabToSidePane(
  tab: AppTabEntry,
  provisioned: ProvisionedTask,
  target: TaskWindowTabTarget
): Promise<void> {
  const tabManager = provisioned.taskView.tabManager;

  let internalId = findInternalTabId(tabManager, target);
  if (!internalId) {
    const bridge = tabManager.topLevelBridge;
    const key = JSON.stringify(target);
    if (bridge) bridge.applyingKey = key;
    try {
      await openProvisionedTaskTab(provisioned, target);
    } finally {
      if (bridge && bridge.applyingKey === key) bridge.applyingKey = null;
    }
    internalId = findInternalTabId(tabManager, target);
  }
  if (!internalId) return;

  const { projectId, taskId } = tab.params as { projectId: string; taskId: string };

  // Single pane slot app-wide: a pin from another task returns that task's
  // previous occupant to its internal store before taking over the column.
  const previous = appState.sidePane.attachment;
  if (previous && (previous.projectId !== projectId || previous.taskId !== taskId)) {
    asProvisioned(
      getTaskStore(previous.projectId, previous.taskId)
    )?.taskView.tabManager.moveSidePaneTabBack();
  }

  tabManager.moveTabToSidePane(internalId);
  appState.sidePane.show(projectId, taskId);
  appState.appTabs.closeTab(tab.id);
}

// ---------------------------------------------------------------------------
// Project-root file tabs
// ---------------------------------------------------------------------------

function buildProjectFileSection(tab: AppTabEntry): ReactNode[] {
  const { projectId, filePath } = tab.params as { projectId?: string; filePath?: string };
  if (!projectId || !filePath) return [];
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
    />,
  ];
}

function fileTarget(
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
