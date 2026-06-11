import { ScrollText } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { TerminalPtyContent } from './terminal-pty-content';
import { useWorkspaceFileLinks } from './use-workspace-file-links';

/**
 * Bottom-drawer scripts mode: the active lifecycle script's PTY output.
 * Script selection and run/stop live in the BottomPanel tab strip.
 */
export const ScriptsPanel = observer(function ScriptsPanel() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const lifecycleScriptsMgr = provisionedTask.workspace.lifecycleScripts ?? null;
  const isActive = useIsActiveTask(taskId);
  const { navigate } = useNavigate();
  const mountedProject = asMounted(getProjectStore(projectId));
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;
  const fileLinks = useWorkspaceFileLinks(remoteConnectionId);

  const autoFocus =
    isActive &&
    provisionedTask.taskView.isTerminalDrawerOpen &&
    provisionedTask.taskView.bottomPanelTab === 'scripts' &&
    provisionedTask.taskView.focusedRegion === 'bottom';

  const scripts = lifecycleScriptsMgr?.tabs ?? [];
  const activeScript = lifecycleScriptsMgr?.activeTab ?? scripts[0];

  if (scripts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<ScrollText className="h-5 w-5 text-muted-foreground" />}
          label={t('tasks.terminals.scriptsEmptyTitle')}
          description={t('tasks.terminals.scriptsEmptyDescription')}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('project', { projectId, view: 'settings' })}
            >
              {t('tasks.terminals.configureInProjectSettings')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="h-full" onFocus={() => provisionedTask.taskView.setFocusedRegion('bottom')}>
      <TerminalPtyContent
        className="h-full"
        activeSession={activeScript?.session ?? null}
        allSessionIds={scripts.map((s) => s.session.sessionId)}
        paneId="scripts-drawer"
        autoFocus={autoFocus}
        emptyState={null}
        remoteConnectionId={remoteConnectionId}
        fileLinks={fileLinks}
      />
    </div>
  );
});
