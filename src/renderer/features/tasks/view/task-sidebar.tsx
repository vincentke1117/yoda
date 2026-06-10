import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useTranslation } from 'react-i18next';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { Tabs, TabsIndicator, TabsList, TabsTab } from '@renderer/lib/ui/tabs';
import { ChangesPanel } from '../diff-view/changes-panel/changes-panel';
import { EditorFileTree } from '../editor/editor-file-tree';
import { isHarnessTab, isSessionFamilyTab, type SidebarTab } from '../types';
import { HarnessPanel } from './harness-panel';
import { SessionPanel } from './session-panel';

/** The tab groups the sidebar exposes after merging the session-family tabs. */
type SidebarTabGroup = 'session' | 'harness' | 'changes' | 'files';

/** Which sidebar tab group is active for the current (legacy) sidebar tab. */
function activeTabGroup(tab: SidebarTab): SidebarTabGroup {
  if (tab === 'changes' || tab === 'files') return tab;
  if (isHarnessTab(tab)) return 'harness';
  return 'session';
}

/** The canonical sidebar tab a tab group activates. */
function sidebarTabForGroup(group: SidebarTabGroup): SidebarTab {
  return group === 'harness' ? 'context' : group;
}

export const TaskSidebar = observer(function TaskSidebar() {
  const { t } = useTranslation();
  const { taskView } = useProvisionedTask();
  const { isSidebarCollapsed, sidebarTab: activeTab } = taskView;
  const sessionActive = isSessionFamilyTab(activeTab);
  const harnessActive = isHarnessTab(activeTab);
  return (
    <Activity mode={isSidebarCollapsed ? 'hidden' : 'visible'}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <div className="shrink-0 px-2 pt-2">
          <Tabs
            value={activeTabGroup(activeTab)}
            onValueChange={(group) =>
              taskView.setSidebarTab(sidebarTabForGroup(group as SidebarTabGroup))
            }
          >
            <TabsList>
              <TabsIndicator />
              <TabsTab value="session">{t('tasks.sessionPanel.title')}</TabsTab>
              <TabsTab value="harness">{t('tasks.sessionPanel.harness')}</TabsTab>
              <TabsTab value="changes">{t('tasks.changes')}</TabsTab>
              <TabsTab value="files">{t('tasks.files')}</TabsTab>
            </TabsList>
          </Tabs>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Activity mode={sessionActive ? 'visible' : 'hidden'}>
            <SessionPanel />
          </Activity>
          <Activity mode={harnessActive ? 'visible' : 'hidden'}>
            <HarnessPanel />
          </Activity>
          <Activity mode={activeTab === 'changes' ? 'visible' : 'hidden'}>
            <ChangesPanel />
          </Activity>
          <Activity mode={activeTab === 'files' ? 'visible' : 'hidden'}>
            <EditorFileTree />
          </Activity>
        </div>
      </div>
    </Activity>
  );
});
