import {
  Copy,
  ExternalLink,
  FileText,
  MoreHorizontal,
  PanelRightOpen,
  TerminalSquare,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getAppById, type OpenInAppId } from '@shared/openInApps';
import { openProjectFileTab } from '@renderer/features/project-file/project-file-session';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useOpenInApps } from '@renderer/lib/hooks/useOpenInApps';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

/**
 * Context-free file actions for any UI that references a path on disk:
 * copy relative/absolute path, open / reveal in the OS file manager, and an
 * SSH-aware terminal fallback. Task-scoped surfaces (open-in-editor,
 * reveal-in-file-tree) compose on top of this — see
 * features/tasks/components/file-actions.tsx.
 */
export type FilePathTarget = {
  absolutePath: string;
  /** Path relative to the project/workspace root, when one applies. */
  relativePath?: string | null;
  kind?: 'file' | 'directory';
  /** Set for SSH projects: disables Finder actions, enables terminal open. */
  sshConnectionId?: string | null;
};

export function useFilePathActions(target: FilePathTarget) {
  const { t } = useTranslation();
  const isRemote = target.sshConnectionId != null;

  return {
    isRemote,
    copyAbsolutePath: () => void copyPath(target.absolutePath, t),
    copyRelativePath: target.relativePath
      ? () => void copyPath(target.relativePath as string, t)
      : null,
    openFile: isRemote
      ? () =>
          void openIn(
            {
              app: 'terminal',
              path: target.absolutePath,
              isRemote: true,
              sshConnectionId: target.sshConnectionId ?? null,
            },
            t
          )
      : () => void openIn({ app: 'finder', path: target.absolutePath }, t),
  };
}

/**
 * All visible "Open in" targets — installed and not hidden in Settings →
 * Open in — with the user's default app first. Finder is included as a
 * regular target (reveal for files, open for directories); Terminal is
 * excluded on remote targets (the open-in-terminal item covers it).
 */
function useOpenInTargets(isRemote: boolean) {
  const { icons, labels, installedApps, loading } = useOpenInApps();
  const { value: openInSettings } = useAppSettingsKey('openIn');

  if (loading) return [];
  const defaultId = openInSettings?.default;
  return installedApps
    .filter((app) => !isRemote || (app.supportsRemote && app.id !== 'terminal'))
    .sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0))
    .map((app) => ({
      id: app.id,
      label: labels[app.id] ?? app.label,
      icon: icons[app.id],
      invertInDark: getAppById(app.id)?.invertInDark === true,
    }));
}

type MenuPrimitives = {
  Item: ComponentType<{
    onClick?: (event: React.MouseEvent) => void;
    disabled?: boolean;
    className?: string;
    children?: ReactNode;
  }>;
  Separator: ComponentType<Record<string, never>>;
};

/**
 * The base file-action menu items, rendered through injected menu primitives so
 * both DropdownMenu and ContextMenu surfaces share one implementation.
 *
 * Group structure (placement items are the caller's first group, see
 * GlobalFileMenuItems / features/tasks/components/file-actions.tsx):
 * open-in apps incl. Finder, then copy-path actions.
 */
export function FilePathMenuItems({
  target,
  components: { Item, Separator },
}: {
  target: FilePathTarget;
  components: MenuPrimitives;
}) {
  const { t } = useTranslation();
  const actions = useFilePathActions(target);
  const openInTargets = useOpenInTargets(actions.isRemote);
  const isDirectory = target.kind === 'directory';

  return (
    <>
      {openInTargets.map((app) => (
        <Item
          key={app.id}
          className="whitespace-nowrap"
          onClick={(event) => {
            event.stopPropagation();
            void openIn(
              {
                app: app.id,
                path: target.absolutePath,
                // Finder "opens" a file by revealing it; opening a directory is literal.
                reveal: app.id === 'finder' && !isDirectory,
                isRemote: actions.isRemote,
                sshConnectionId: target.sshConnectionId ?? null,
              },
              t
            );
          }}
        >
          {app.icon ? (
            <img
              src={app.icon}
              alt={app.label}
              className={cn('size-4 rounded', app.invertInDark && 'dark:invert')}
            />
          ) : (
            <ExternalLink className="size-4" />
          )}
          {t('fileActions.openInApp', { app: app.label })}
        </Item>
      ))}
      {actions.isRemote ? (
        <Item
          className="whitespace-nowrap"
          onClick={(event) => {
            event.stopPropagation();
            actions.openFile();
          }}
        >
          <TerminalSquare className="size-4" />
          {t('fileActions.openInTerminal')}
        </Item>
      ) : null}
      <Separator />
      {actions.copyRelativePath ? (
        <Item
          className="whitespace-nowrap"
          onClick={(event) => {
            event.stopPropagation();
            actions.copyRelativePath?.();
          }}
        >
          <Copy className="size-4" />
          {t('fileActions.copyRelativePath')}
        </Item>
      ) : null}
      <Item
        className="whitespace-nowrap"
        onClick={(event) => {
          event.stopPropagation();
          actions.copyAbsolutePath();
        }}
      >
        <Copy className="size-4" />
        {t('fileActions.copyAbsolutePath')}
      </Item>
    </>
  );
}

/**
 * Dropdown trigger (ellipsis button) with the base file actions. Extra
 * context-specific items can be prepended via `children`; they render above the
 * base items, separated automatically.
 */
export function FilePathActionsDropdown({
  target,
  className,
  children,
}: {
  target: FilePathTarget;
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex size-5 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
              className
            )}
            aria-label={t('fileActions.label')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        {children ? (
          <>
            {children}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <FilePathMenuItems
          target={target}
          components={{ Item: DropdownMenuItem, Separator: DropdownMenuSeparator }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** In-app surface a global file can be placed in (used for the "current" marker). */
export type GlobalFileSurface = 'main' | 'globalSidePane';

/**
 * Full menu for standalone files outside any project/task (agent-home files:
 * SKILL.md, user CLAUDE.md, …), via injected menu primitives so dropdowns,
 * submenus, and context menus share it. Groups: in-app placement (main area /
 * global side pane, the current surface marked), then the base path actions.
 */
export function GlobalFileMenuItems({
  absolutePath,
  currentSurface,
  components,
}: {
  absolutePath: string;
  /** Surface the menu is shown from; its placement item gets a "current" marker. */
  currentSurface?: GlobalFileSurface;
  components: MenuPrimitives;
}) {
  const { t } = useTranslation();
  const { Item, Separator } = components;
  const placementLabel = (label: string, surface: GlobalFileSurface) =>
    currentSurface === surface ? t('fileActions.currentLabel', { label }) : label;

  return (
    <>
      <Item
        className="whitespace-nowrap"
        onClick={(event) => {
          event.stopPropagation();
          openProjectFileTab(null, absolutePath);
        }}
      >
        <FileText className="size-4" />
        {placementLabel(t('fileActions.openInMainArea'), 'main')}
      </Item>
      <Item
        className="whitespace-nowrap"
        onClick={(event) => {
          event.stopPropagation();
          appState.sidePane.pinView('file', { filePath: absolutePath });
        }}
      >
        <PanelRightOpen className="size-4" />
        {placementLabel(t('appTabs.openInGlobalSidePane'), 'globalSidePane')}
      </Item>
      <Separator />
      <FilePathMenuItems target={{ absolutePath, kind: 'file' }} components={components} />
    </>
  );
}

/**
 * Dropdown trigger (ellipsis button) wrapping GlobalFileMenuItems. Task
 * surfaces use features/tasks/components/file-actions instead, which adds the
 * task-sidebar placement on top.
 */
export function GlobalFileActionsDropdown({
  absolutePath,
  currentSurface,
  className,
}: {
  absolutePath: string;
  currentSurface?: GlobalFileSurface;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex size-5 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
              className
            )}
            aria-label={t('fileActions.label')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <GlobalFileMenuItems
          absolutePath={absolutePath}
          currentSurface={currentSurface}
          components={{ Item: DropdownMenuItem, Separator: DropdownMenuSeparator }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function copyPath(path: string, t: (key: string) => string): Promise<void> {
  try {
    const res = await rpc.app.clipboardWriteText(path);
    if (res?.success) {
      toast({ title: t('fileActions.pathCopied') });
      return;
    }
  } catch {
    // handled below
  }
  toast({ title: t('common.copyFailed'), variant: 'destructive' });
}

async function openIn(
  args: {
    app: OpenInAppId;
    path: string;
    reveal?: boolean;
    isRemote?: boolean;
    sshConnectionId?: string | null;
  },
  t: (key: string) => string
): Promise<void> {
  try {
    const res = await rpc.app.openIn(args);
    if (!res?.success) {
      toast({
        title: t('fileActions.openFailed'),
        description: res?.error,
        variant: 'destructive',
      });
    }
  } catch (error) {
    toast({
      title: t('fileActions.openFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });
  }
}
