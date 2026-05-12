import { ExternalLink, GitBranch, Github } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  asMounted,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';

export const RepoStatusCard = observer(function RepoStatusCard({
  projectId,
}: {
  projectId: string;
}) {
  const project = asMounted(getProjectStore(projectId));
  const repo = getRepositoryStore(projectId);

  if (!project) return null;

  const branchLabel = repo?.defaultBranch
    ? repo.defaultBranch.type === 'remote'
      ? `${repo.defaultBranch.remote.name}/${repo.defaultBranch.branch}`
      : repo.defaultBranch.branch
    : '—';
  const currentBranch = repo?.currentBranch ?? '—';
  const remote = repo?.configuredRemote;
  const repositoryUrl = repo?.repositoryUrl ?? null;
  const projectPath = project.data.path;

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-foreground">Repository</h2>
        {repositoryUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void rpc.app.openExternal(repositoryUrl)}
          >
            <Github className="size-3.5" />
            Open on GitHub
            <ExternalLink className="size-3" />
          </Button>
        )}
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
        <dt className="text-foreground-muted">Path</dt>
        <dd className="font-mono truncate" title={projectPath}>
          {projectPath}
        </dd>
        <dt className="text-foreground-muted">Current branch</dt>
        <dd className="font-mono inline-flex items-center gap-1">
          <GitBranch className="size-3" />
          {currentBranch}
        </dd>
        <dt className="text-foreground-muted">Default branch</dt>
        <dd className="font-mono">{branchLabel}</dd>
        {remote && (
          <>
            <dt className="text-foreground-muted">Remote</dt>
            <dd className="font-mono truncate" title={remote.url || undefined}>
              {remote.name}
              {remote.url ? ` · ${remote.url}` : ''}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
});
