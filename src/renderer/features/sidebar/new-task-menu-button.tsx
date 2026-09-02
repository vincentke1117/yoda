import { formatForDisplay } from '@tanstack/react-hotkeys';
import { SquarePen } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  NEW_TASK_OPEN_MODE_LABEL_KEYS,
  openNewTaskFromPreference,
  otherNewTaskOpenMode,
} from '@renderer/app/open-new-task';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useOverrideModifier } from '@renderer/lib/hooks/use-override-modifier';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { SidebarMenuButton } from './sidebar-primitives';

/**
 * The primary creation entry. Opens a task the way the persisted preference
 * says; holding the configured override key (Alt/Option by default) opens it the
 * other way for one click, and the label names that other mode in parentheses
 * while the key is down so the override is discoverable without a second sidebar
 * entry.
 */
export function NewTaskMenuButton({
  isActive,
  currentProjectId,
}: {
  isActive: boolean;
  currentProjectId?: string;
}) {
  const { t } = useTranslation();
  const { value: interfaceSettings } = useAppSettingsKey('interface');
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const overrideHotkey = getEffectiveHotkey('newTaskToggle', keyboard);
  const { held, isActive: isOverride } = useOverrideModifier(overrideHotkey);
  const alternateMode = otherNewTaskOpenMode(interfaceSettings?.newTaskOpenMode ?? 'home');
  const alternateLabel = t(NEW_TASK_OPEN_MODE_LABEL_KEYS[alternateMode]);
  const label = held ? t('sidebar.newTaskInMode', { mode: alternateLabel }) : t('sidebar.newTask');
  const overrideKey = overrideHotkey ? formatForDisplay(overrideHotkey) : '';
  const handleClick = React.useCallback(() => {
    void openNewTaskFromPreference(currentProjectId, isOverride());
  }, [currentProjectId, isOverride]);

  return (
    <SidebarMenuButton
      isActive={isActive}
      onClick={handleClick}
      aria-label={label}
      title={
        overrideHotkey
          ? t('sidebar.newTaskAltHint', { mode: alternateLabel, key: overrideKey })
          : label
      }
      className="w-full justify-between"
    >
      <span className="flex items-center gap-2 min-w-0 w-full">
        <SquarePen className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
        <span className="truncate min-w-0">{label}</span>
      </span>
      <ShortcutHint settingsKey="newTask" />
    </SidebarMenuButton>
  );
}
