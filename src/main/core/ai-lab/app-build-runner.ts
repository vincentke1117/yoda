import {
  aiLabAppCreatedChannel,
  aiLabAppUpdatedChannel,
  aiLabBuildFailedChannel,
} from '@shared/events/aiLabEvents';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { loadClaudeTranscript } from '@main/core/conversations/claude-transcript';
import { loadCodexRolloutTranscriptForConversation } from '@main/core/conversations/codex-rollout-terminal-history';
import { getConversationsForTask } from '@main/core/conversations/getConversationsForTask';
import { projectManager } from '@main/core/projects/project-manager';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  extractGeneratedAppFromTranscript,
  type GeneratedAiLabApp,
} from './app-generation-contract';
import type { AiLabAppStore } from './app-store';
import type { AiLabBuildJob, AiLabBuildJobStore } from './build-job-store';

const TRANSCRIPT_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500, 2_000];

export class AiLabAppBuildRunner {
  private initialized = false;
  private subscriptions = new Map<string, () => void>();
  private processing = new Set<string>();

  constructor(
    private readonly jobs: AiLabBuildJobStore,
    private readonly apps: AiLabAppStore
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const [pending, apps] = await Promise.all([this.jobs.list(), this.apps.list()]);
    const jobsByTaskId = new Map(pending.map((job) => [job.taskId, job]));
    for (const app of apps) {
      if (
        !app.projectId ||
        !app.taskId ||
        !app.conversationId ||
        (app.runtimeId !== 'codex' && app.runtimeId !== 'claude') ||
        jobsByTaskId.has(app.taskId)
      ) {
        continue;
      }
      const recovered: AiLabBuildJob = {
        appId: app.id,
        projectId: app.projectId,
        taskId: app.taskId,
        conversationId: app.conversationId,
        prompt: app.prompt,
        runtimeId: app.runtimeId,
        model: app.model,
        createdAt: app.createdAt,
      };
      jobsByTaskId.set(app.taskId, recovered);
      await this.jobs.put(recovered);
    }
    this.initialized = true;
    for (const job of jobsByTaskId.values()) this.track(job);
  }

  async prepare(job: AiLabBuildJob): Promise<void> {
    await this.initialize();
    await this.jobs.put(job);
    this.track(job);
  }

  async cancel(taskId: string): Promise<void> {
    this.untrack(taskId);
    await this.jobs.delete(taskId);
  }

  private track(job: AiLabBuildJob): void {
    this.untrack(job.taskId);
    const session = {
      projectId: job.projectId,
      taskId: job.taskId,
      conversationId: job.conversationId,
    };
    this.subscriptions.set(
      job.taskId,
      agentSessionRuntimeStore.subscribe(session, (state) => {
        if (state.status === 'completed') void this.finish(job);
        if (state.status === 'error') {
          events.emit(aiLabBuildFailedChannel, {
            ...session,
            message: 'The Yoda Build agent reported an error. Continue in the task to retry.',
          });
        }
      })
    );
    if (agentSessionRuntimeStore.getStatus(session) === 'completed') void this.finish(job);
  }

  private untrack(taskId: string): void {
    this.subscriptions.get(taskId)?.();
    this.subscriptions.delete(taskId);
  }

  private async finish(job: AiLabBuildJob): Promise<void> {
    if (this.processing.has(job.taskId)) return;
    this.processing.add(job.taskId);
    try {
      const generated = await this.readGeneratedAppWithRetry(job);
      const target = await this.resolveTargetApp(job);
      if (target) {
        const result = await this.apps.replaceGenerated(target.id, generated);
        const trackedJob = { ...job, appId: target.id };
        await this.jobs.put(trackedJob);
        if (result.changed) {
          events.emit(aiLabAppUpdatedChannel, {
            appId: result.app.id,
            appName: result.app.name,
          });
        }
      } else {
        const app = await this.apps.create({
          ...generated,
          prompt: job.prompt,
          projectId: job.projectId,
          taskId: job.taskId,
          conversationId: job.conversationId,
          runtimeId: job.runtimeId,
          model: job.model,
        });
        await this.jobs.put({ ...job, appId: app.id });
        events.emit(aiLabAppCreatedChannel, {
          projectId: job.projectId,
          taskId: job.taskId,
          conversationId: job.conversationId,
          appId: app.id,
          appName: app.name,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('[ai-lab] failed to collect Yoda Build task output', {
        projectId: job.projectId,
        taskId: job.taskId,
        conversationId: job.conversationId,
        error: message,
      });
      events.emit(aiLabBuildFailedChannel, {
        projectId: job.projectId,
        taskId: job.taskId,
        conversationId: job.conversationId,
        message,
      });
    } finally {
      this.processing.delete(job.taskId);
    }
  }

  private async resolveTargetApp(job: AiLabBuildJob) {
    const apps = await this.apps.list();
    if (job.appId) return apps.find((app) => app.id === job.appId) ?? null;
    return (
      apps.find((app) => app.taskId === job.taskId && app.conversationId === job.conversationId) ??
      null
    );
  }

  private async readGeneratedAppWithRetry(job: AiLabBuildJob): Promise<GeneratedAiLabApp> {
    let lastError: unknown = new Error('The Yoda Build transcript is not ready.');
    for (const delayMs of TRANSCRIPT_RETRY_DELAYS_MS) {
      await sleep(delayMs);
      try {
        return await this.readGeneratedApp(job);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async readGeneratedApp(job: AiLabBuildJob): Promise<GeneratedAiLabApp> {
    const project = projectManager.getProject(job.projectId);
    if (!project) throw new Error('The source project is not available.');
    const conversation = (await getConversationsForTask(job.projectId, job.taskId)).find(
      (candidate) => candidate.id === job.conversationId
    );
    if (!conversation) throw new Error('The Yoda Build conversation is not available.');

    const blocks =
      job.runtimeId === 'claude'
        ? await loadClaudeTranscript({ cwd: project.repoPath, sessionId: job.conversationId })
        : await loadCodexRolloutTranscriptForConversation({
            conversation,
            cwd: project.repoPath,
          });
    if (!blocks?.length) throw new Error('The Yoda Build transcript is empty.');
    return extractGeneratedAppFromTranscript(blocks);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
