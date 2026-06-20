import { FolderGit2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@renderer/lib/ui/dropdown-menu';

interface MoveToProjectSubmenuProps {
  /** Project the task currently belongs to — excluded from the target list. */
  currentProjectId: string;
  /** Re-home the task under the chosen project. */
  onMove: (targetProjectId: string) => void;
}

/** Registered projects (incl. the Default project) other than the current one. */
function useMoveTargets(currentProjectId: string): { id: string; name: string }[] {
  return Array.from(getProjectManagerStore().projects.values())
    .filter((p) => p.state !== 'unregistered' && p.data !== null && p.id !== currentProjectId)
    .map((p) => ({ id: p.id, name: p.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Context-menu variant of the "move to project" submenu. */
export const MoveToProjectContextSubmenu = observer(function MoveToProjectContextSubmenu({
  currentProjectId,
  onMove,
}: MoveToProjectSubmenuProps) {
  const { t } = useTranslation();
  const targets = useMoveTargets(currentProjectId);
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger className="whitespace-nowrap">
          <FolderGit2 className="size-4" />
          {t('tasks.context.moveToProject')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {targets.length === 0 ? (
            <ContextMenuItem disabled>{t('tasks.context.moveToProjectEmpty')}</ContextMenuItem>
          ) : (
            targets.map((target) => (
              <ContextMenuItem
                key={target.id}
                className="whitespace-nowrap"
                onClick={() => onMove(target.id)}
              >
                {target.name}
              </ContextMenuItem>
            ))
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
});

/** Dropdown-menu variant of {@link MoveToProjectContextSubmenu}. */
export const MoveToProjectDropdownSubmenu = observer(function MoveToProjectDropdownSubmenu({
  currentProjectId,
  onMove,
}: MoveToProjectSubmenuProps) {
  const { t } = useTranslation();
  const targets = useMoveTargets(currentProjectId);
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="whitespace-nowrap">
          <FolderGit2 className="size-4" />
          {t('tasks.context.moveToProject')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {targets.length === 0 ? (
            <DropdownMenuItem disabled>{t('tasks.context.moveToProjectEmpty')}</DropdownMenuItem>
          ) : (
            targets.map((target) => (
              <DropdownMenuItem
                key={target.id}
                className="whitespace-nowrap"
                onClick={() => onMove(target.id)}
              >
                {target.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
});
