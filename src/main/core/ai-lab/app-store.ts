import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AiLabProjectKind, AiLabUserApp } from '@shared/ai-lab';
import { isValidRuntimeId } from '@shared/runtime-registry';

type GeneratedAppUpdate = Pick<AiLabUserApp, 'name' | 'description' | 'html'> & {
  prompt?: string;
};

export class AiLabAppStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<AiLabUserApp[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isStoredApp).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async create(input: {
    name: string;
    description: string;
    prompt: string;
    html: string;
    projectKind?: AiLabProjectKind;
    projectId?: string;
    taskId?: string;
    conversationId?: string;
    runtimeId?: AiLabUserApp['runtimeId'];
    model?: string | null;
  }): Promise<AiLabUserApp> {
    return this.enqueue(async () => {
      const apps = await this.list();
      const now = new Date().toISOString();
      const app: AiLabUserApp = {
        id: randomUUID(),
        ...input,
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };
      await this.write([app, ...apps]);
      return app;
    });
  }

  async update(id: string, update: { pinned: boolean }): Promise<AiLabUserApp> {
    return this.enqueue(async () => {
      const apps = await this.list();
      const index = apps.findIndex((app) => app.id === id);
      const current = apps[index];
      if (!current) throw new Error('AI Lab app not found.');
      const next = { ...current, ...update, updatedAt: new Date().toISOString() };
      apps[index] = next;
      await this.write(apps);
      return next;
    });
  }

  async assignProject(id: string, projectId: string): Promise<AiLabUserApp> {
    return this.enqueue(async () => {
      const apps = await this.list();
      const index = apps.findIndex((app) => app.id === id);
      const current = apps[index];
      if (!current) throw new Error('AI Lab app not found.');
      const {
        taskId: _legacyTaskId,
        conversationId: _legacyConversationId,
        ...appWithoutLegacyBuildSource
      } = current;
      const next: AiLabUserApp = {
        ...appWithoutLegacyBuildSource,
        projectKind: 'app',
        projectId,
        updatedAt: nextTimestamp(current.updatedAt),
      };
      apps[index] = next;
      await this.write(apps);
      return next;
    });
  }

  async replaceGenerated(
    id: string,
    update: GeneratedAppUpdate
  ): Promise<{ app: AiLabUserApp; changed: boolean }> {
    return this.enqueue(async () => {
      const apps = await this.list();
      const index = apps.findIndex((app) => app.id === id);
      const current = apps[index];
      if (!current) throw new Error('AI Lab app not found.');
      const changed =
        current.name !== update.name ||
        current.description !== update.description ||
        current.html !== update.html ||
        (update.prompt !== undefined && current.prompt !== update.prompt);
      if (!changed) return { app: current, changed: false };
      const next: AiLabUserApp = {
        ...current,
        ...update,
        updatedAt: nextTimestamp(current.updatedAt),
      };
      apps[index] = next;
      await this.write(apps);
      return { app: next, changed: true };
    });
  }

  async delete(id: string): Promise<void> {
    await this.enqueue(async () => {
      const apps = await this.list();
      const next = apps.filter((app) => app.id !== id);
      if (next.length === apps.length) throw new Error('AI Lab app not found.');
      await this.write(next);
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

  private async write(apps: AiLabUserApp[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(apps, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }
}

function nextTimestamp(previous: string): string {
  const previousTime = Date.parse(previous);
  const now = Date.now();
  return new Date(
    Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now
  ).toISOString();
}

function isStoredApp(value: unknown): value is AiLabUserApp {
  if (!value || typeof value !== 'object') return false;
  const app = value as Partial<AiLabUserApp>;
  return (
    typeof app.id === 'string' &&
    typeof app.name === 'string' &&
    typeof app.description === 'string' &&
    typeof app.prompt === 'string' &&
    typeof app.html === 'string' &&
    (app.projectKind === undefined || app.projectKind === 'app') &&
    (app.projectId === undefined || typeof app.projectId === 'string') &&
    (app.taskId === undefined || typeof app.taskId === 'string') &&
    (app.conversationId === undefined || typeof app.conversationId === 'string') &&
    (app.runtimeId === undefined || isValidRuntimeId(app.runtimeId)) &&
    (app.model === undefined || app.model === null || typeof app.model === 'string') &&
    typeof app.pinned === 'boolean' &&
    typeof app.createdAt === 'string' &&
    typeof app.updatedAt === 'string'
  );
}
