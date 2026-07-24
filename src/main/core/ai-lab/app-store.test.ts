import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AiLabAppStore } from './app-store';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('AiLabAppStore', () => {
  it('creates, pins, and deletes an app with atomic JSON persistence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-'));
    directories.push(directory);
    const filePath = join(directory, 'apps.json');
    const store = new AiLabAppStore(filePath);
    const created = await store.create({
      name: 'Packing',
      description: 'A packing list',
      prompt: 'Build a packing list',
      html: '<!doctype html><html></html>',
      projectKind: 'app',
      projectId: 'travel-project',
      taskId: 'build-task',
      conversationId: 'build-conversation',
      runtimeId: 'codex',
      model: 'gpt-5.4',
    });

    expect((await store.list())[0]).toMatchObject({
      id: created.id,
      projectKind: 'app',
      projectId: 'travel-project',
      taskId: 'build-task',
      conversationId: 'build-conversation',
      runtimeId: 'codex',
      model: 'gpt-5.4',
      pinned: false,
    });
    expect(await store.update(created.id, { pinned: true })).toMatchObject({ pinned: true });
    const replaced = await store.replaceGenerated(created.id, {
      name: 'Packing together',
      description: 'A shared packing list',
      html: '<!doctype html><html><body>Updated</body></html>',
    });
    expect(replaced).toMatchObject({
      changed: true,
      app: { name: 'Packing together', pinned: true },
    });
    expect(replaced.app.updatedAt).not.toBe(created.updatedAt);
    await expect(
      store.replaceGenerated(created.id, {
        name: replaced.app.name,
        description: replaced.app.description,
        html: replaced.app.html,
      })
    ).resolves.toMatchObject({ changed: false, app: { updatedAt: replaced.app.updatedAt } });
    const reassigned = await store.assignProject(created.id, 'packing-app-project');
    expect(reassigned).toMatchObject({
      projectKind: 'app',
      projectId: 'packing-app-project',
    });
    expect(reassigned).not.toHaveProperty('taskId');
    expect(reassigned).not.toHaveProperty('conversationId');
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toHaveLength(1);

    await store.delete(created.id);
    expect(await store.list()).toEqual([]);
  });

  it('keeps concurrent app completions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-'));
    directories.push(directory);
    const store = new AiLabAppStore(join(directory, 'apps.json'));
    await Promise.all(
      ['Timer', 'Notes'].map((name) =>
        store.create({
          name,
          description: `${name} app`,
          prompt: `Build ${name}`,
          html: '<!doctype html><html></html>',
        })
      )
    );

    expect((await store.list()).map((app) => app.name).sort()).toEqual(['Notes', 'Timer']);
  });
});
