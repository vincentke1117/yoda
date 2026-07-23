import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isValidRuntimeId, type RuntimeId } from '@shared/runtime-registry';

export type AiLabBuildJob = {
  appId?: string;
  projectId: string;
  taskId: string;
  conversationId: string;
  prompt: string;
  runtimeId: RuntimeId;
  model?: string | null;
  createdAt: string;
};

export class AiLabBuildJobStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<AiLabBuildJob[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter(isStoredJob) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async put(job: AiLabBuildJob): Promise<void> {
    await this.enqueue(async () => {
      const jobs = await this.list();
      await this.write([job, ...jobs.filter((current) => current.taskId !== job.taskId)]);
    });
  }

  async delete(taskId: string): Promise<void> {
    await this.enqueue(async () => {
      const jobs = await this.list();
      await this.write(jobs.filter((job) => job.taskId !== taskId));
    });
  }

  private enqueue<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(mutation, mutation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async write(jobs: AiLabBuildJob[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(jobs, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }
}

function isStoredJob(value: unknown): value is AiLabBuildJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<AiLabBuildJob>;
  return (
    (job.appId === undefined || typeof job.appId === 'string') &&
    typeof job.projectId === 'string' &&
    typeof job.taskId === 'string' &&
    typeof job.conversationId === 'string' &&
    typeof job.prompt === 'string' &&
    isValidRuntimeId(job.runtimeId) &&
    (job.model === undefined || job.model === null || typeof job.model === 'string') &&
    typeof job.createdAt === 'string'
  );
}
