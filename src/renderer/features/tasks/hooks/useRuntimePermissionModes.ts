import {
  getDefaultPermissionModeId,
  getRuntimePermissionModes,
  isDangerPermissionMode,
  type RuntimeId,
} from '@shared/runtime-registry';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

export function useRuntimePermissionModes() {
  const { value, isLoading, isSaving, update } = useAppSettingsKey('runtimePermissionModes');
  const selections = value ?? {};
  const getMode = (runtimeId: RuntimeId) =>
    selections[runtimeId] ?? getDefaultPermissionModeId(runtimeId);

  return {
    selections,
    loading: isLoading,
    saving: isSaving,
    getModes: (runtimeId: RuntimeId) => getRuntimePermissionModes(runtimeId),
    getMode,
    /** Whether the runtime's selected tier auto-approves (maps to legacy autoApprove). */
    isDanger: (runtimeId: RuntimeId) => isDangerPermissionMode(runtimeId, getMode(runtimeId)),
    setMode: (runtimeId: RuntimeId, modeId: string) => update({ [runtimeId]: modeId }),
  };
}
