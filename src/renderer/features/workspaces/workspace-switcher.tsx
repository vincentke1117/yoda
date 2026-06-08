import { Check, ChevronsUpDown, FolderInput, Pencil, Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ALL_WORKSPACES_ID, DEFAULT_WORKSPACE_ID } from '@shared/workspaces';
import { toast } from '@renderer/lib/hooks/use-toast';
import { workspaceStore } from '@renderer/lib/stores/app-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

/**
 * Current-workspace selector for the sidebar footer. Shows the active workspace
 * name and opens a dropdown to switch between "All" and user workspaces, plus
 * inline create / rename / delete of the active one. Workspaces scope the
 * pinned list, projects, and projectless tasks shown below.
 */
export const WorkspaceSwitcher = observer(function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const workspaces = workspaceStore.workspaces;
  const activeId = workspaceStore.activeWorkspaceId;
  const activeWorkspace = workspaceStore.activeWorkspace;
  const [renaming, setRenaming] = React.useState(false);

  const currentName =
    activeWorkspace?.name ??
    (activeId === DEFAULT_WORKSPACE_ID ? t('workspaces.defaultTab') : t('workspaces.allTab'));
  const currentLabel = t('workspaces.current', { name: currentName });

  async function handleCreate() {
    try {
      const created = await workspaceStore.createWorkspace(t('workspaces.defaultName'));
      workspaceStore.setActiveWorkspaceId(created.id);
      setRenaming(true);
    } catch (error) {
      toast({
        title: t('workspaces.createFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }

  async function handleRename(name: string) {
    setRenaming(false);
    const trimmed = name.trim();
    if (!activeWorkspace || !trimmed || trimmed === activeWorkspace.name) return;
    try {
      await workspaceStore.renameWorkspace(activeWorkspace.id, trimmed);
    } catch (error) {
      toast({
        title: t('workspaces.renameFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }

  async function handleDelete() {
    if (!activeWorkspace) return;
    try {
      await workspaceStore.deleteWorkspace(activeWorkspace.id);
    } catch (error) {
      toast({
        title: t('workspaces.deleteFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }

  if (renaming && activeWorkspace) {
    return (
      <WorkspaceNameInput
        initialValue={activeWorkspace.name}
        onSubmit={(name) => void handleRename(name)}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'group/ws flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-foreground-tertiary-muted transition-colors outline-none',
          'hover:bg-background-tertiary-1 hover:text-foreground-tertiary',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'data-popup-open:bg-background-tertiary-1 data-popup-open:text-foreground-tertiary'
        )}
        aria-label={t('workspaces.switch')}
      >
        <span className="flex min-w-0 items-center gap-2">
          <FolderInput className="h-4 w-4 shrink-0" />
          <span className="truncate">{currentLabel}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-foreground-tertiary-passive transition-colors group-hover/ws:text-foreground-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-(--anchor-width) min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('workspaces.switch')}</DropdownMenuLabel>
          <WorkspaceChoice
            label={t('workspaces.allTab')}
            isActive={activeId === ALL_WORKSPACES_ID}
            onSelect={() => workspaceStore.setActiveWorkspaceId(ALL_WORKSPACES_ID)}
          />
          <WorkspaceChoice
            label={t('workspaces.defaultTab')}
            isActive={activeId === DEFAULT_WORKSPACE_ID}
            onSelect={() => workspaceStore.setActiveWorkspaceId(DEFAULT_WORKSPACE_ID)}
          />
          {workspaces.map((workspace) => (
            <WorkspaceChoice
              key={workspace.id}
              label={workspace.name}
              isActive={activeId === workspace.id}
              onSelect={() => workspaceStore.setActiveWorkspaceId(workspace.id)}
            />
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleCreate()}>
          <Plus className="size-4" />
          {t('workspaces.create')}
        </DropdownMenuItem>
        {activeWorkspace && (
          <>
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil className="size-4" />
              {t('workspaces.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => void handleDelete()}>
              <Trash2 className="size-4" />
              {t('workspaces.delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

function WorkspaceChoice({
  label,
  isActive,
  onSelect,
}: {
  label: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onClick={onSelect}>
      <Check className={cn('size-4', isActive ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{label}</span>
    </DropdownMenuItem>
  );
}

function WorkspaceNameInput({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initialValue);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onSubmit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit(value);
        else if (e.key === 'Escape') onCancel();
      }}
      className="h-8 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    />
  );
}
