import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AiLabBuildJobStore } from './build-job-store';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('AiLabBuildJobStore', () => {
  it('persists one app binding per task and supports removal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-build-'));
    directories.push(directory);
    const store = new AiLabBuildJobStore(join(directory, 'build-jobs.json'));

    await store.put({
      projectId: 'project-1',
      appId: 'app-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      prompt: 'Build a timer',
      runtimeId: 'codex',
      model: null,
      createdAt: '2026-07-18T00:00:00.000Z',
    });
    await store.put({
      projectId: 'project-1',
      appId: 'app-2',
      taskId: 'task-1',
      conversationId: 'conversation-2',
      prompt: 'Build a better timer',
      runtimeId: 'claude',
      createdAt: '2026-07-18T00:01:00.000Z',
    });

    expect(await store.list()).toEqual([
      expect.objectContaining({
        taskId: 'task-1',
        conversationId: 'conversation-2',
        appId: 'app-2',
      }),
    ]);
    await store.delete('task-1');
    expect(await store.list()).toEqual([]);
  });

  it('keeps jobs prepared concurrently for different tasks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-build-'));
    directories.push(directory);
    const store = new AiLabBuildJobStore(join(directory, 'build-jobs.json'));
    await Promise.all(
      ['task-1', 'task-2'].map((taskId) =>
        store.put({
          projectId: 'project-1',
          taskId,
          conversationId: `${taskId}-conversation`,
          prompt: `Build ${taskId}`,
          runtimeId: 'codex',
          createdAt: '2026-07-18T00:00:00.000Z',
        })
      )
    );

    expect((await store.list()).map((job) => job.taskId).sort()).toEqual(['task-1', 'task-2']);
  });
});
