import type { Branch } from '@shared/git';
import type { CreateTaskStrategy, ForkTaskMode } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';

/**
 * Where a task derived from another one runs — the shared resolution behind
 * forks and sibling tasks, so neither invents git work of its own.
 *
 * `same-branch` hits the same `localWorkspaceId` key as the source task, so the
 * worktree is shared by refcount instead of cloned; `new-branch` branches off it
 * into a worktree of its own. A source task without a branch has no worktree to
 * share or branch off, so its derivatives stay worktree-less.
 */
export async function resolveDerivedTaskTarget(
  projectId: string,
  sourceTask: { name: string; taskBranch?: string; sourceBranch: Branch | undefined },
  mode: ForkTaskMode
): Promise<{ strategy: CreateTaskStrategy; sourceBranch: Branch }> {
  if (!sourceTask.taskBranch) {
    return {
      strategy: { kind: 'no-worktree' },
      sourceBranch: sourceTask.sourceBranch ?? (await currentBranchOf(projectId)),
    };
  }
  return {
    strategy:
      mode === 'same-branch'
        ? { kind: 'checkout-existing' }
        : { kind: 'new-branch', taskBranch: sourceTask.name },
    sourceBranch: { type: 'local', branch: sourceTask.taskBranch },
  };
}

async function currentBranchOf(projectId: string): Promise<Branch> {
  const project = projectManager.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const { currentBranch } = await project.repository.getRepositoryInfo();
  if (!currentBranch) throw new Error(`Project has no current branch: ${projectId}`);
  return { type: 'local', branch: currentBranch };
}
