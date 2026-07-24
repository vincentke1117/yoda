import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { iterateFileLines, readFirstFileLine } from './file-lines';

describe('file line readers', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('discards an oversized line and resumes at the following line', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'yoda-file-lines-'));
    directories.push(directory);
    const path = join(directory, 'transcript.jsonl');
    writeFileSync(path, `first\n${'x'.repeat(5 * 1024 * 1024)}\nlast\n`);

    const lines: string[] = [];
    for await (const line of iterateFileLines(path, { maxLineChars: 1024 * 1024 })) {
      lines.push(line);
    }

    expect(lines).toEqual(['first', 'last']);
  });

  it('reads only the first line', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'yoda-first-line-'));
    directories.push(directory);
    const path = join(directory, 'transcript.jsonl');
    writeFileSync(path, 'metadata\nsecond\n');

    await expect(readFirstFileLine(path)).resolves.toBe('metadata');
  });

  it('can bound the total bytes read from a file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'yoda-bounded-lines-'));
    directories.push(directory);
    const path = join(directory, 'transcript.jsonl');
    writeFileSync(path, 'first\nsecond\nthird\n');

    const lines: string[] = [];
    for await (const line of iterateFileLines(path, { maxReadBytes: 12 })) {
      lines.push(line);
    }

    expect(lines).toEqual(['first', 'second']);
  });
});
