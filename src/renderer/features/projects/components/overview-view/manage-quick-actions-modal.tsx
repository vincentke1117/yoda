import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import type { QuickAction } from '@shared/project-settings';
import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';

type ManageQuickActionsModalArgs = { projectId: string };
type Props = BaseModalProps<void> & ManageQuickActionsModalArgs;

function genId(): string {
  return crypto.randomUUID();
}

function actionsEqual(a: QuickAction[], b: QuickAction[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.label !== y.label || x.command !== y.command) return false;
  }
  return true;
}

export const ManageQuickActionsModal = observer(function ManageQuickActionsModal({
  projectId,
  onSuccess,
  onClose,
}: Props) {
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const globalDefaults: QuickAction[] = useMemo(
    () => homeDraft?.defaultQuickActions ?? [],
    [homeDraft?.defaultQuickActions]
  );

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Null means "use global defaults"; an array means project-specific override. */
  const [override, setOverride] = useState<QuickAction[] | null>(null);
  const [initial, setInitial] = useState<QuickAction[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settingsStore = getProjectSettingsStore(projectId);
    if (!settingsStore) {
      setError('Project not ready');
      setLoading(false);
      return;
    }
    void (async () => {
      await settingsStore.pageData.load();
      if (cancelled) return;
      const existing = settingsStore.settings?.quickActions ?? null;
      setOverride(existing);
      setInitial(existing);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const displayList: QuickAction[] = override ?? globalDefaults;
  const usingDefaults = override === null;
  const dirty =
    initial === null ? override !== null : override === null || !actionsEqual(override, initial);

  const updateRow = (id: string, patch: Partial<Pick<QuickAction, 'label' | 'command'>>) => {
    setOverride((prev) => {
      const base = prev ?? globalDefaults;
      return base.map((a) => (a.id === id ? { ...a, ...patch } : a));
    });
  };

  const deleteRow = (id: string) => {
    setOverride((prev) => {
      const base = prev ?? globalDefaults;
      return base.filter((a) => a.id !== id);
    });
  };

  const addRow = () => {
    setOverride((prev) => {
      const base = prev ?? globalDefaults;
      return [...base, { id: genId(), label: '', command: '' }];
    });
  };

  const resetToGlobal = () => {
    setOverride(null);
  };

  const handleSubmit = async () => {
    if (loading || submitting) return;
    const settingsStore = getProjectSettingsStore(projectId);
    const currentSettings = settingsStore?.settings;
    if (!settingsStore || !currentSettings) {
      setError('Project not ready');
      return;
    }
    setSubmitting(true);
    setError(null);
    const cleaned: QuickAction[] | undefined =
      override === null
        ? undefined
        : override.filter((a) => a.label.trim() !== '' && a.command.trim() !== '');
    const nextSettings = JSON.parse(
      JSON.stringify({ ...currentSettings, quickActions: cleaned })
    ) as typeof currentSettings;
    const updateRes = await settingsStore.save(nextSettings);
    if (!updateRes.success) {
      setError('Failed to save project settings');
      setSubmitting(false);
      return;
    }
    onSuccess();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Quick Actions</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <p className="text-xs text-foreground-muted">
          Quick actions appear on the project overview. Clicking one spawns a new task that runs the
          command in a fresh conversation. Use slash commands like{' '}
          <code className="font-mono">/release-via-cicd</code> or any prompt text.
        </p>
        {usingDefaults && (
          <p className="text-xs text-foreground-muted">
            Using global defaults. Edit any row to create a project-specific override.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {displayList.map((action) => (
            <div key={action.id} className="flex items-center gap-2">
              <Input
                className="w-32"
                placeholder="Label"
                value={action.label}
                disabled={loading}
                onChange={(e) => updateRow(action.id, { label: e.target.value })}
              />
              <Input
                className="flex-1"
                placeholder="/release-via-cicd"
                value={action.command}
                disabled={loading}
                onChange={(e) => updateRow(action.id, { command: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={loading}
                onClick={() => deleteRow(action.id)}
                aria-label="Remove"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={loading} onClick={addRow}>
              <Plus className="size-3.5" />
              Add action
            </Button>
            {!usingDefaults && (
              <Button variant="ghost" size="sm" disabled={loading} onClick={resetToGlobal}>
                <RotateCcw className="size-3.5" />
                Reset to global default
              </Button>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton
          onClick={() => void handleSubmit()}
          disabled={loading || submitting || !dirty}
        >
          {submitting ? 'Saving…' : 'Save'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
