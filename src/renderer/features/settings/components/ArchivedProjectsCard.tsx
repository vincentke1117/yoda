import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, FolderClosed, FolderInput } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { projectDisplayName, type LocalProject, type SshProject } from '@shared/projects';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';

const QUERY_KEY = ['archivedProjects'];

export default function ArchivedProjectsCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => rpc.projects.getArchivedProjects(),
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleUnarchive = async (projectId: string) => {
    setBusyId(projectId);
    try {
      await getProjectManagerStore().unarchiveProject(projectId);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (err) {
      toast({
        title: t('settings.archivedProjects.unarchiveFailed'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <p className="text-sm text-foreground-muted">{t('settings.archivedProjects.loading')}</p>
    );
  }

  if (!data || data.length === 0) {
    return <p className="text-sm text-foreground-muted">{t('settings.archivedProjects.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-muted/10 p-2">
      {data.map((project) => (
        <ArchivedProjectRow
          key={project.id}
          project={project}
          busy={busyId === project.id}
          onUnarchive={() => handleUnarchive(project.id)}
        />
      ))}
    </div>
  );
}

function ArchivedProjectRow({
  project,
  busy,
  onUnarchive,
}: {
  project: LocalProject | SshProject;
  busy: boolean;
  onUnarchive: () => void;
}) {
  const { t } = useTranslation();
  const Icon = project.type === 'ssh' ? FolderInput : FolderClosed;
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2">
      <Icon className="h-4 w-4 shrink-0 text-foreground-muted" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{projectDisplayName(project)}</span>
        <span className="truncate text-xs text-foreground-muted">{project.path}</span>
      </div>
      <Button variant="outline" size="sm" onClick={onUnarchive} disabled={busy}>
        <ArchiveRestore className="size-3" />
        {t('settings.archivedProjects.unarchive')}
      </Button>
    </div>
  );
}
