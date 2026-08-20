import { GitFork } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ForkTaskMode } from '@shared/tasks';
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

interface ForkTaskSubmenuProps {
  onFork: (mode: ForkTaskMode) => void;
  showSeparator?: boolean;
}

/**
 * "Fork" submenu shared by the task context and dropdown menus. A fork always
 * produces a new task; the two entries only differ in where that task works —
 * the source task's own branch (shared worktree) or a branch of its own.
 */
export function ForkTaskContextSubmenu({ onFork, showSeparator = true }: ForkTaskSubmenuProps) {
  const { t } = useTranslation();
  return (
    <>
      {showSeparator && <ContextMenuSeparator />}
      <ContextMenuSub>
        <ContextMenuSubTrigger className="whitespace-nowrap">
          <GitFork className="size-4" />
          {t('tasks.fork.menu')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem className="whitespace-nowrap" onClick={() => onFork('same-branch')}>
            {t('tasks.fork.sameBranch')}
          </ContextMenuItem>
          <ContextMenuItem className="whitespace-nowrap" onClick={() => onFork('new-branch')}>
            {t('tasks.fork.newBranch')}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
}

/** Dropdown-menu variant of {@link ForkTaskContextSubmenu}. */
export function ForkTaskDropdownSubmenu({ onFork, showSeparator = true }: ForkTaskSubmenuProps) {
  const { t } = useTranslation();
  return (
    <>
      {showSeparator && <DropdownMenuSeparator />}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="whitespace-nowrap">
          <GitFork className="size-4" />
          {t('tasks.fork.menu')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem className="whitespace-nowrap" onClick={() => onFork('same-branch')}>
            {t('tasks.fork.sameBranch')}
          </DropdownMenuItem>
          <DropdownMenuItem className="whitespace-nowrap" onClick={() => onFork('new-branch')}>
            {t('tasks.fork.newBranch')}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}
