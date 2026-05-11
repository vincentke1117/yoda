import { useCallback, useState } from 'react';
import { deriveTaskSlug, liveTransformTaskDisplayName } from '@shared/task-name';

export type TaskNameState = {
  taskName: string;
  handleTaskNameChange: (value: string) => void;
  branchSlugPreview: string | null;
  isPending: boolean;
};

export function useTaskName(opts?: {
  generatedName?: string;
  isPending?: boolean;
  resetKey?: unknown;
}): TaskNameState {
  const { generatedName, isPending = false, resetKey } = opts ?? {};
  const [taskName, setTaskName] = useState(generatedName ?? '');
  const [prevGeneratedName, setPrevGeneratedName] = useState(generatedName);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);

  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setPrevGeneratedName(generatedName);
    setTaskName(generatedName ?? '');
  } else if (generatedName !== prevGeneratedName) {
    setPrevGeneratedName(generatedName);
    if (generatedName !== undefined) {
      setTaskName(generatedName);
    }
  }

  const handleTaskNameChange = useCallback((value: string) => {
    setTaskName(liveTransformTaskDisplayName(value));
  }, []);

  const slug = deriveTaskSlug(taskName);
  const branchSlugPreview = slug && slug !== taskName.trim() ? slug : null;

  return { taskName, handleTaskNameChange, branchSlugPreview, isPending };
}
