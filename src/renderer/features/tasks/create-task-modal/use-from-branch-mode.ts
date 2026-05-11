import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { type Branch } from '@shared/git';
import { taskNameFromPrompt } from '@shared/task-name';
import { rpc } from '@renderer/lib/ipc';
import { useBranchSelection } from './use-branch-selection';

export type FromBranchModeState = ReturnType<typeof useFromBranchMode>;

export function useFromBranchMode(
  selectedProjectId: string | undefined,
  defaultBranch: Branch | undefined,
  isUnborn: boolean,
  currentBranchName: string | null | undefined,
  initialPrompt: string
) {
  const branchSelection = useBranchSelection(
    selectedProjectId,
    defaultBranch,
    isUnborn,
    currentBranchName
  );

  // Random fallback slug, generated once per modal mount. Used when the user
  // hasn't typed an initial prompt yet — the task still needs a name + branch
  // slug at create time; agent auto-rename will overwrite it later.
  const stableKey = useMemo(() => crypto.randomUUID(), []);
  const { data: fallbackName } = useQuery({
    queryKey: ['generateTaskName', 'random', stableKey],
    queryFn: () => rpc.tasks.generateTaskName({}),
    refetchOnWindowFocus: false,
  });

  const promptDerived = taskNameFromPrompt(initialPrompt);
  const taskName = promptDerived || fallbackName || '';

  const isValid = taskName.trim().length > 0 && branchSelection.selectedBranch !== undefined;

  return {
    ...branchSelection,
    taskName,
    isValid,
  };
}
