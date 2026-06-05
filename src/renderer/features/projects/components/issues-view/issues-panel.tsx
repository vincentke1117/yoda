import { ExternalLink, Github, Link2, Loader2, RefreshCw, ScanSearch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { Issue, Task } from '@shared/tasks';
import { useIssues } from '@renderer/features/integrations/use-issues';
import { CreateIssueButton } from '@renderer/features/projects/components/issues-view/create-issue-button';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import {
  IssueIdentifier,
  ProviderLogo,
  StatusDot,
} from '@renderer/features/tasks/components/issue-selector/issue-selector';
import { isRegistered, type TaskStore } from '@renderer/features/tasks/stores/task';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

const ISSUE_FETCH_LIMIT = 50;
type ReadySessionStore = TaskStore & { data: Task };

function getLinkedIssues(task: Task): Issue[] {
  return task.linkedIssues ?? (task.linkedIssue ? [task.linkedIssue] : []);
}

function isIssueLinkedToSession(issue: Issue, session: ReadySessionStore): boolean {
  return getLinkedIssues(session.data).some((linkedIssue) => linkedIssue.url === issue.url);
}

const IssueSessionLinkPopover = observer(function IssueSessionLinkPopover({
  issue,
  projectId,
}: {
  issue: Issue;
  projectId: string;
}) {
  const { t } = useTranslation();
  const taskManager = getTaskManagerStore(projectId);
  const sessions = taskManager
    ? Array.from(taskManager.tasks.values())
        .filter((store): store is ReadySessionStore => isRegistered(store))
        .filter((store) => !store.data.archivedAt)
    : [];
  const linkedCount = sessions.filter((session) => isIssueLinkedToSession(issue, session)).length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm">
            <Link2 className="size-3.5" />
            {linkedCount > 0
              ? t('issues.linkedSessionCount', { count: linkedCount })
              : t('issues.linkSessions')}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 p-2">
        <div className="px-2 pb-2 text-xs font-medium text-foreground-muted">
          {t('issues.linkSessions')}
        </div>
        {sessions.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-foreground-passive">
            {t('issues.noSessionsToLink')}
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {sessions.map((session) => {
              const checked = isIssueLinkedToSession(issue, session);
              return (
                <div
                  key={session.data.id}
                  role="button"
                  tabIndex={0}
                  className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    if (checked) {
                      void session.unlinkIssue(issue.url);
                    } else {
                      void session.linkIssue(issue);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    if (checked) {
                      void session.unlinkIssue(issue.url);
                    } else {
                      void session.linkIssue(issue);
                    }
                  }}
                >
                  <Checkbox
                    checked={checked}
                    aria-hidden
                    tabIndex={-1}
                    className="pointer-events-none"
                  />
                  <span className="min-w-0 flex-1 truncate">{session.data.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});

const ProjectIssueRow = observer(function ProjectIssueRow({
  issue,
  projectId,
}: {
  issue: Issue;
  projectId: string;
}) {
  const { t } = useTranslation();
  const showCreateTaskModal = useShowModal('taskModal');
  const assignees = issue.assignees ?? [];

  return (
    <div className="group relative flex items-start gap-3 rounded-lg p-3 py-4 hover:bg-background-1 transition-colors">
      <div className="pt-1 shrink-0">
        <ProviderLogo provider={issue.provider} className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-sm leading-snug text-foreground">
              {issue.title}
            </span>
            <IssueIdentifier identifier={issue.identifier} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    disabled={!issue.url}
                    onClick={() => issue.url && rpc.app.openExternal(issue.url)}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                }
              />
              <TooltipContent>{t('issues.openOnGitHub')}</TooltipContent>
            </Tooltip>
          </div>
          {issue.updatedAt ? (
            <RelativeTime
              value={issue.updatedAt}
              className="shrink-0 text-xs text-foreground-passive"
              compact
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-foreground-muted">
          {issue.status ? (
            <Badge
              variant="outline"
              className="flex items-center gap-1.5 rounded-md font-normal text-xs"
            >
              <StatusDot status={issue.status} />
              {issue.status}
            </Badge>
          ) : null}
          {assignees.length > 0 ? (
            <span className="min-w-0 truncate">
              {t('issues.assignees', { assignees: assignees.join(', ') })}
            </span>
          ) : null}
        </div>
      </div>
      <div className="pointer-events-none absolute right-3 top-0 flex h-full items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <IssueSessionLinkPopover issue={issue} projectId={projectId} />
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            showCreateTaskModal({ projectId, strategy: 'from-issue', initialIssue: issue })
          }
        >
          <ScanSearch className="size-3.5" />
          {t('issues.createTask')}
        </Button>
      </div>
    </div>
  );
});

export const IssuesPanel = observer(function IssuesPanel() {
  const { t } = useTranslation();
  const {
    params: { projectId },
  } = useParams('project');
  const repositoryUrl = getRepositoryStore(projectId)?.repositoryUrl ?? null;
  const { authenticated, isInitialized, needsGhAuth } = useGithubContext();
  const { navigate } = useNavigate();

  const {
    issues,
    isLoading,
    isRefreshing,
    error,
    searchTerm,
    setSearchTerm,
    isSearching,
    refresh,
    syncCreatedIssue,
  } = useIssues('github', {
    projectId,
    repositoryUrl: repositoryUrl ?? undefined,
    initialLimit: ISSUE_FETCH_LIMIT,
    enabled: Boolean(repositoryUrl) && isInitialized && authenticated,
  });

  if (!repositoryUrl) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col px-6 pt-6">
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
          <EmptyState
            label={t('issues.noGitHubRemote')}
            description={t('issues.noGitHubRemoteConfigured')}
          />
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center">
        <Loader2 className="size-4 animate-spin text-foreground-muted" />
      </div>
    );
  }

  if (needsGhAuth) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col px-6 pt-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          <div className="mt-4 flex w-full flex-col items-center justify-center gap-5 rounded-md border border-border border-dashed p-8">
            <span className="relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-background-2">
              <Github className="size-4 text-foreground-muted" />
            </span>
            <p className="text-center text-sm font-normal text-foreground-muted">
              {t('issues.githubAuthRequired')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() =>
                navigate('settings', {
                  tab: 'account',
                })
              }
            >
              {t('issues.connectUserAccount')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isBusy = isLoading || isSearching;
  const hasSearch = searchTerm.trim().length > 0;

  return (
    <div className="relative mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-6 pt-6">
      <div className="flex shrink-0 flex-col gap-4 border-b border-border pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-foreground-muted">
            {t('issues.openCount', { count: issues.length })}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <CreateIssueButton repositoryUrl={repositoryUrl} onCreated={syncCreatedIssue} />
            <SearchInput
              placeholder={t('issues.searchByTitleNumber')}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-64"
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={isRefreshing}
                    onClick={() => void refresh()}
                  >
                    <RefreshCw className={isRefreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
                  </Button>
                }
              />
              <TooltipContent>{t('issues.refresh')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      {isBusy && issues.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-foreground-muted" />
        </div>
      ) : issues.length === 0 ? (
        <EmptyState
          label={hasSearch ? t('issues.noIssuesFound') : t('issues.noOpenIssues')}
          description={hasSearch ? undefined : t('issues.noOpenIssuesDescription')}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-3">
          {issues.map((issue) => (
            <ProjectIssueRow
              key={issue.url || issue.identifier}
              issue={issue}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </div>
  );
});
