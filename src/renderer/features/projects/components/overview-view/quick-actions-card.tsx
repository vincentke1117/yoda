import { Play, Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import type { QuickAction } from '@shared/project-settings';
import { runProjectCommand } from '@renderer/features/projects/run-project-command';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { log } from '@renderer/utils/logger';

export const QuickActionsCard = observer(function QuickActionsCard({
  projectId,
}: {
  projectId: string;
}) {
  const { navigate } = useNavigate();
  const project = asMounted(getProjectStore(projectId));
  const settingsStore = getProjectSettingsStore(projectId);
  const repo = getRepositoryStore(projectId);
  const showManage = useShowModal('manageQuickActionsModal');

  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const connectionId = project?.data?.type === 'ssh' ? project.data.connectionId : undefined;
  const { providerId } = useEffectiveProvider(connectionId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();

  const projectActions = settingsStore?.settings?.quickActions;
  const globalDefaults = homeDraft?.defaultQuickActions ?? [];
  const actions: QuickAction[] = projectActions ?? globalDefaults;

  const [runningId, setRunningId] = useState<string | null>(null);

  const handleRun = async (action: QuickAction) => {
    if (!project || !providerId) return;
    setRunningId(action.id);
    try {
      const taskId = await runProjectCommand({
        project,
        action,
        providerId,
        defaultBranch: repo?.defaultBranch,
        autoApprove: autoApproveDefaults.getDefault(providerId),
      });
      if (taskId) navigate('task', { projectId, taskId });
    } catch (err) {
      log.warn('runProjectCommand failed', { projectId, action, error: String(err) });
    } finally {
      setRunningId(null);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-foreground">Quick Actions</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => showManage({ projectId })}
          aria-label="Manage quick actions"
        >
          <Settings2 className="size-3.5" />
          Manage
        </Button>
      </header>
      {actions.length === 0 ? (
        <p className="text-xs text-foreground-muted">
          No quick actions configured. Click Manage to add one (e.g. /release-via-cicd).
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.id}
              variant="outline"
              size="sm"
              disabled={!project || !providerId || runningId !== null}
              onClick={() => void handleRun(action)}
            >
              <Play className="size-3.5" />
              {runningId === action.id ? `Running ${action.label}…` : action.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
});
