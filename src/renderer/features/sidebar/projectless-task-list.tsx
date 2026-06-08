import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { workspaceStore } from '@renderer/lib/stores/app-state';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarSectionHeader,
} from './sidebar-primitives';
import { compareSidebarInstantsDesc } from './sidebar-store';
import { SidebarTaskItem } from './task-item';

const MAX_TASKS_RENDERED = 50;

export const SidebarProjectlessTaskList = observer(function SidebarProjectlessTaskList() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const internalProject = asMounted(getProjectStore(INTERNAL_PROJECT_ID));
  if (!internalProject) return null;

  const tasks = Array.from(internalProject.taskManager.tasks.values())
    .filter((task) => !('archivedAt' in task.data) || !task.data.archivedAt)
    .filter((task) => !task.data.isPinned)
    .filter((task) =>
      workspaceStore.matchesActive(
        'sidebarWorkspaceId' in task.data ? task.data.sidebarWorkspaceId : null
      )
    )
    .sort((a, b) => {
      const aTime = a.data.lastInteractedAt ?? a.data.createdAt;
      const bTime = b.data.lastInteractedAt ?? b.data.createdAt;
      return compareSidebarInstantsDesc(aTime, bTime);
    })
    .slice(0, MAX_TASKS_RENDERED);

  if (tasks.length === 0) return null;

  return (
    <SidebarGroup className="mb-0 shrink-0 flex flex-col">
      <SidebarSectionHeader
        label={t('sidebar.tasks')}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
      {!collapsed && (
        <SidebarGroupContent>
          <SidebarMenu className="px-3 pb-3">
            {tasks.map((task) => (
              <SidebarTaskItem
                key={task.data.id}
                taskId={task.data.id}
                projectId={INTERNAL_PROJECT_ID}
                rowVariant="flat"
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
});
