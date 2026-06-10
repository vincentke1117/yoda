import { useCallback, useState } from 'react';
import type { Branch } from '@shared/git';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

export type BranchSelectionState = ReturnType<typeof useBranchSelection>;

export function useBranchSelection(
  selectedProjectId: string | undefined,
  defaultBranch: Branch | undefined,
  isUnborn: boolean,
  currentBranchName?: string | null,
  initialBranch?: Branch
) {
  const { value: project, update: updateProject } = useAppSettingsKey('project');
  const pushBranch = project?.pushOnCreate ?? true;
  const createBranchAndWorktree = isUnborn ? false : (project?.createBranchAndWorktree ?? true);

  // Store the user's branch override alongside the project it belongs to.
  // When the project changes the override is for a different project and is
  // ignored, so defaultBranch takes effect automatically — no effect needed.
  // `initialBranch` (e.g. a parent task's branch when creating a subtask)
  // seeds the override for the opening project; the user can still change it.
  const [branchOverride, setBranchOverride] = useState<
    { projectId: string; branch: Branch } | undefined
  >(() =>
    initialBranch && selectedProjectId
      ? { projectId: selectedProjectId, branch: initialBranch }
      : undefined
  );

  const selectedBranch: Branch | undefined =
    !createBranchAndWorktree && currentBranchName
      ? { type: 'local', branch: currentBranchName }
      : branchOverride !== undefined && branchOverride.projectId === selectedProjectId
        ? branchOverride.branch
        : defaultBranch;

  const setSelectedBranch = useCallback(
    (branch: Branch | undefined) => {
      if (!selectedProjectId || !branch) {
        setBranchOverride(undefined);
        return;
      }
      setBranchOverride({ projectId: selectedProjectId, branch });
    },
    [selectedProjectId]
  );
  const setPushBranch = useCallback(
    (value: boolean) => {
      updateProject({ pushOnCreate: value });
    },
    [updateProject]
  );
  const setCreateBranchAndWorktree = useCallback(
    (value: boolean) => {
      if (isUnborn) return;
      updateProject({ createBranchAndWorktree: value });
    },
    [isUnborn, updateProject]
  );

  return {
    selectedBranch,
    setSelectedBranch,
    createBranchAndWorktree,
    setCreateBranchAndWorktree,
    pushBranch,
    setPushBranch,
  };
}
