import type {
  Branch,
  BranchesPayload,
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  LocalBranch,
  LocalBranchesPayload,
  PushError,
  RemoteBranch,
  RemoteBranchesPayload,
  RenameBranchError,
} from '@shared/git';
import { selectPreferredRemote } from '@shared/git-utils';
import type { ProjectRemoteState } from '@shared/projects';
import type { Result } from '@shared/result';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import { log } from '@main/lib/logger';
import type { RepositoryGitProvider } from './repository-git-provider';

function isNotAGitRepoError(error: unknown): boolean {
  const stderr = (error as { stderr?: unknown })?.stderr;
  return typeof stderr === 'string' && stderr.includes('not a git repository');
}

export class GitRepositoryService {
  private notAGitRepoWarned = false;

  constructor(
    private readonly git: RepositoryGitProvider,
    private readonly settings: ProjectSettingsProvider
  ) {}

  private handleNotAGitRepo(method: string, error: unknown): boolean {
    if (!isNotAGitRepoError(error)) return false;
    if (!this.notAGitRepoWarned) {
      this.notAGitRepoWarned = true;
      log.warn(`GitRepositoryService.${method}: working directory is not a git repository`);
    }
    return true;
  }

  async getConfiguredRemote(): Promise<string> {
    const [configured, remotes] = await Promise.all([
      this.settings.getRemote().catch(() => undefined),
      this.git.getRemotes().catch(() => []),
    ]);
    return selectPreferredRemote(configured, remotes).name;
  }

  async getRepositoryInfo(): Promise<{ isUnborn: boolean; currentBranch: string | null }> {
    const headState = await this.git.getHeadState();
    const currentBranch = headState.isUnborn
      ? (headState.headName ?? null)
      : await this.git.getCurrentBranch();
    return { isUnborn: headState.isUnborn, currentBranch };
  }

  async getBranchesPayload(): Promise<BranchesPayload> {
    try {
      const remotes = await this.git.getRemotes();
      const remote = await this.getConfiguredRemote();
      const branches = await this.git.getBranches();
      const gitDefaultBranch = await this.git.getDefaultBranch(remote);

      if (branches.length === 0) {
        const headState = await this.git.getHeadState();
        return {
          branches: [],
          currentBranch: headState.headName ?? null,
          isUnborn: headState.isUnborn,
          gitDefaultBranch,
          remotes,
        };
      }
      const currentBranch = await this.git.getCurrentBranch();
      return {
        branches,
        currentBranch,
        isUnborn: false,
        gitDefaultBranch,
        remotes,
      };
    } catch (error) {
      if (this.handleNotAGitRepo('getBranchesPayload', error)) {
        return {
          branches: [],
          currentBranch: null,
          isUnborn: true,
          gitDefaultBranch: '',
          remotes: [],
        };
      }
      throw error;
    }
  }

  async getRemotes(): Promise<{ name: string; url: string }[]> {
    return this.git.getRemotes();
  }

  async addRemote(name: string, url: string): Promise<void> {
    return this.git.addRemote(name, url);
  }

  async createBranch(
    name: string,
    from: string,
    syncWithRemote?: boolean,
    remote?: string
  ): Promise<Result<void, CreateBranchError>> {
    return this.git.createBranch(name, from, syncWithRemote, remote);
  }

  async renameBranch(
    oldBranch: string,
    newBranch: string
  ): Promise<Result<{ remotePushed: boolean }, RenameBranchError>> {
    return this.git.renameBranch(oldBranch, newBranch);
  }

  async deleteBranch(branch: string, force?: boolean): Promise<Result<void, DeleteBranchError>> {
    return this.git.deleteBranch(branch, force);
  }

  async fetchPrForReview(
    prNumber: number,
    headRefName: string,
    headRepositoryUrl: string,
    localBranch: string,
    isFork: boolean,
    remote?: string
  ): Promise<Result<void, FetchPrForReviewError>> {
    return this.git.fetchPrForReview(
      prNumber,
      headRefName,
      headRepositoryUrl,
      localBranch,
      isFork,
      remote
    );
  }

  async fetch(remote?: string): Promise<Result<void, FetchError>> {
    return this.git.fetch(remote);
  }

  async publishBranch(
    branchName: string,
    remote?: string
  ): Promise<Result<{ output: string }, PushError>> {
    return this.git.publishBranch(branchName, remote);
  }

  async getBranches(): Promise<Branch[]> {
    await this.fetch();
    return this.git.getBranches();
  }

  async getLocalBranchesPayload(): Promise<LocalBranchesPayload> {
    try {
      const branches = await this.git.getBranches();
      const localBranches = branches.filter((b): b is LocalBranch => b.type === 'local');
      if (localBranches.length === 0) {
        const headState = await this.git.getHeadState();
        return {
          localBranches: [],
          currentBranch: headState.headName ?? null,
          isUnborn: headState.isUnborn,
        };
      }
      const currentBranch = await this.git.getCurrentBranch();
      return { localBranches, currentBranch, isUnborn: false };
    } catch (error) {
      if (this.handleNotAGitRepo('getLocalBranchesPayload', error)) {
        return { localBranches: [], currentBranch: null, isUnborn: true };
      }
      throw error;
    }
  }

  async getRemoteBranchesPayload(): Promise<RemoteBranchesPayload> {
    try {
      const [branches, remotes, remote] = await Promise.all([
        this.git.getBranches(),
        this.git.getRemotes(),
        this.getConfiguredRemote(),
      ]);
      const remoteBranches = branches.filter((b): b is RemoteBranch => b.type === 'remote');
      const gitDefaultBranch = await this.git.getDefaultBranch(remote);
      return { remoteBranches, remotes, gitDefaultBranch };
    } catch (error) {
      if (this.handleNotAGitRepo('getRemoteBranchesPayload', error)) {
        return { remoteBranches: [], remotes: [], gitDefaultBranch: '' };
      }
      throw error;
    }
  }

  async getRemoteState(): Promise<ProjectRemoteState> {
    try {
      const remotes = await this.getRemotes();
      const remoteName = await this.getConfiguredRemote();
      const remoteUrl = remotes.find((r) => r.name === remoteName)?.url;
      return { hasRemote: remotes.length > 0, selectedRemoteUrl: remoteUrl ?? null };
    } catch {
      return { hasRemote: false, selectedRemoteUrl: null };
    }
  }
}
