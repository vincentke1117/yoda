import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeAiLabProjectHtml } from './app-project-files';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('writeAiLabProjectHtml', () => {
  it('atomically replaces the runnable App project source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-project-'));
    directories.push(directory);

    await writeAiLabProjectHtml(directory, '<!doctype html><html>First</html>');
    await writeAiLabProjectHtml(directory, '<!doctype html><html>Second</html>');

    await expect(readFile(join(directory, 'index.html'), 'utf8')).resolves.toContain('Second');
  });
});
