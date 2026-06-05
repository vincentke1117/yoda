import { ArrowRight, CircleDot } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useIssues } from '@renderer/features/integrations/use-issues';
import { CreateIssueButton } from '@renderer/features/projects/components/issues-view/create-issue-button';
import {
  asMounted,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import type { ProjectView } from '@renderer/features/projects/stores/project-view';
import { IssueIdentifier } from '@renderer/features/tasks/components/issue-selector/issue-selector';
import { rpc } from '@renderer/lib/ipc';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';

const ISSUE_FETCH_LIMIT = 50;
const RECENT_LIMIT = 3;

export const IssuesOverviewCard = observer(function IssuesOverviewCard({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const project = asMounted(getProjectStore(projectId));
  const repo = getRepositoryStore(projectId);
  const repositoryUrl = repo?.repositoryUrl ?? null;
  const { authenticated, isInitialized } = useGithubContext();

  const { issues, isLoading, syncCreatedIssue } = useIssues('github', {
    projectId,
    repositoryUrl: repositoryUrl ?? undefined,
    initialLimit: ISSUE_FETCH_LIMIT,
    enabled: Boolean(repositoryUrl) && isInitialized && authenticated,
  });

  const recentIssues = issues.slice(0, RECENT_LIMIT);

  const goToIssues = () => {
    if (project) project.view.setProjectView('issues' as ProjectView);
  };

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <CircleDot className="size-3.5" />
            {t('issues.issues')}
          </h2>
          <span className="text-xs text-foreground-muted">
            {t('issues.openCount', { count: issues.length })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <CreateIssueButton
            repositoryUrl={repositoryUrl}
            disabled={!isInitialized || !authenticated}
            onCreated={syncCreatedIssue}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={goToIssues}
            disabled={!repositoryUrl || !authenticated}
          >
            {t('projects.viewAll')}
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </header>
      {!repositoryUrl ? (
        <p className="text-xs text-foreground-muted">{t('issues.noGitHubRemoteConfigured')}</p>
      ) : isInitialized && !authenticated ? (
        <p className="text-xs text-foreground-muted">{t('issues.githubAuthRequired')}</p>
      ) : isLoading && issues.length === 0 ? (
        <p className="text-xs text-foreground-muted">{t('common.loading')}</p>
      ) : recentIssues.length === 0 ? (
        <p className="text-xs text-foreground-muted">{t('issues.noOpenIssues')}</p>
      ) : (
        <ul className="space-y-1">
          {recentIssues.map((issue) => (
            <li key={issue.url || issue.identifier}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-background-hover"
                onClick={() => void rpc.app.openExternal(issue.url)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <IssueIdentifier identifier={issue.identifier} />
                  <span className="truncate font-medium text-foreground">{issue.title}</span>
                </span>
                {issue.updatedAt ? (
                  <span className="shrink-0 text-foreground-muted">
                    <RelativeTime value={issue.updatedAt} compact />
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
