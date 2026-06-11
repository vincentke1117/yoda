import { FolderOpen } from 'lucide-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const GithubSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const {
    value: project,
    update: updateProject,
    isLoading: projectLoading,
    isSaving: projectSaving,
    isFieldOverridden: isProjectFieldOverridden,
    resetField: resetProjectField,
  } = useAppSettingsKey('project');
  const {
    value: localProject,
    defaults: localProjectDefaults,
    update: updateLocalProject,
    isLoading: localProjectLoading,
    isSaving: localProjectSaving,
    isFieldOverridden: isLocalProjectFieldOverridden,
    resetField: resetLocalProjectField,
  } = useAppSettingsKey('localProject');

  const branchPrefix = project?.branchPrefix ?? '';
  const pushOnCreate = project?.pushOnCreate ?? true;
  const writeAgentConfigToGitIgnore = localProject?.writeAgentConfigToGitIgnore ?? true;
  const worktreeDirectory = localProject?.defaultWorktreeDirectory ?? '';
  const defaultWorktreeDirectory = localProjectDefaults?.defaultWorktreeDirectory ?? '';
  const projectBusy = projectLoading || projectSaving;
  const localProjectBusy = localProjectLoading || localProjectSaving;

  const example = useMemo(() => {
    return `${branchPrefix}/my-feature-a3f`;
  }, [branchPrefix]);

  const commitWorktreeDirectory = (raw: string) => {
    const next = raw.trim();
    if (next === worktreeDirectory) return;
    if (next) {
      updateLocalProject({ defaultWorktreeDirectory: next });
    } else {
      resetLocalProjectField('defaultWorktreeDirectory');
    }
  };

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Input
            key={branchPrefix}
            defaultValue={branchPrefix}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== branchPrefix) {
                updateProject({ branchPrefix: next });
              }
            }}
            placeholder={t('settings.branchPrefix.placeholder')}
            aria-label={t('settings.branchPrefix.aria')}
            disabled={projectBusy}
            className="flex-1"
          />
          <ResetToDefaultButton
            visible={isProjectFieldOverridden('branchPrefix')}
            defaultLabel="yoda"
            onReset={() => resetProjectField('branchPrefix')}
            disabled={projectBusy}
          />
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t('settings.branchPrefix.example')}{' '}
          <code className="rounded bg-muted/60 px-1">{example}</code>
        </div>
      </div>
      <SettingRow
        title={t('settings.repositoryTab.autoPush')}
        description={t('settings.branchPrefix.autoPushDescription')}
        control={
          <>
            <ResetToDefaultButton
              visible={isProjectFieldOverridden('pushOnCreate')}
              defaultLabel="on"
              onReset={() => resetProjectField('pushOnCreate')}
              disabled={projectBusy}
            />
            <Switch
              checked={pushOnCreate}
              onCheckedChange={(checked) => updateProject({ pushOnCreate: checked })}
              disabled={projectBusy}
              aria-label={t('settings.repositoryTab.autoPushAria')}
            />
          </>
        }
      />
      <SettingRow
        title={t('settings.repositoryTab.autoUpdateGitignore')}
        description={t('settings.branchPrefix.autoUpdateGitignoreDescription')}
        control={
          <>
            <ResetToDefaultButton
              visible={isLocalProjectFieldOverridden('writeAgentConfigToGitIgnore')}
              defaultLabel="on"
              onReset={() => resetLocalProjectField('writeAgentConfigToGitIgnore')}
              disabled={localProjectBusy}
            />
            <Switch
              checked={writeAgentConfigToGitIgnore}
              onCheckedChange={(checked) =>
                updateLocalProject({ writeAgentConfigToGitIgnore: checked })
              }
              disabled={localProjectBusy}
              aria-label={t('settings.repositoryTab.autoUpdateGitignoreAria')}
            />
          </>
        }
      />
      <div className="grid gap-2">
        <div className="text-sm text-foreground">
          {t('settings.repositoryTab.defaultWorktreeDirectory')}
        </div>
        <div className="text-xs text-foreground-passive">
          {t('settings.repositoryTab.defaultWorktreeDirectoryDescription')}
        </div>
        <div className="flex items-center gap-2">
          <Input
            key={worktreeDirectory}
            defaultValue={worktreeDirectory}
            onBlur={(e) => commitWorktreeDirectory(e.target.value)}
            placeholder={defaultWorktreeDirectory}
            aria-label={t('settings.repositoryTab.defaultWorktreeDirectoryAria')}
            disabled={localProjectBusy}
            className="flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0"
            disabled={localProjectBusy}
            aria-label={t('settings.repositoryTab.defaultWorktreeDirectoryBrowse')}
            onClick={async () => {
              const path = await rpc.app.openSelectDirectoryDialog({
                title: t('settings.repositoryTab.defaultWorktreeDirectory'),
                message: t('settings.repositoryTab.defaultWorktreeDirectoryDescription'),
              });
              if (path) commitWorktreeDirectory(path);
            }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
          <ResetToDefaultButton
            visible={isLocalProjectFieldOverridden('defaultWorktreeDirectory')}
            defaultLabel={defaultWorktreeDirectory}
            onReset={() => resetLocalProjectField('defaultWorktreeDirectory')}
            disabled={localProjectBusy}
          />
        </div>
      </div>
    </div>
  );
};

export default GithubSettingsCard;
