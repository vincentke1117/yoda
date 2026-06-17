/**
 * Regenerates the bundled snapshot of jujumilk3/leaked-system-prompts.
 *
 * The snapshot powers the read-only "reference" gallery in the prompt library:
 * it ships with the app so the gallery works offline and renders instantly,
 * while the runtime revalidates it against GitHub (see leaked-prompts-service).
 *
 * Usage:
 *   node --experimental-strip-types scripts/generate-leaked-prompts-snapshot.ts [--repo <dir>]
 *
 * Without --repo the script downloads the latest tarball via `curl` (which
 * honours the ambient https_proxy), so a refresh is a one-liner.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  parseLeakedPromptFilename,
  LEAKED_PROMPTS_REPO as REPO,
  type LeakedPromptMeta,
} from '../src/shared/leaked-prompts.ts';

const OUT = resolve(
  import.meta.dirname,
  '../src/main/core/leaked-prompts/leaked-prompts-snapshot.json'
);

type SnapshotEntry = LeakedPromptMeta & { content: string };

function resolveRepoDir(): { dir: string; sha: string } {
  const flagIndex = process.argv.indexOf('--repo');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return { dir: process.argv[flagIndex + 1], sha: 'local' };
  }
  const tmp = mkdtempSync(join(tmpdir(), 'lsp-'));
  const sha = execFileSync('curl', ['-sL', `https://api.github.com/repos/${REPO}/commits/main`])
    .toString()
    .match(/"sha":\s*"([0-9a-f]{40})"/)?.[1];
  if (!sha) throw new Error('could not resolve HEAD sha');
  const tgz = join(tmp, 'repo.tgz');
  execFileSync('curl', ['-sL', `https://codeload.github.com/${REPO}/tar.gz/${sha}`, '-o', tgz]);
  execFileSync('tar', ['-xzf', tgz, '-C', tmp]);
  const inner = readdirSync(tmp).find((name) => name.startsWith('leaked-system-prompts-'));
  if (!inner) throw new Error('extracted repo dir not found');
  return { dir: join(tmp, inner), sha };
}

function main(): void {
  const { dir, sha } = resolveRepoDir();
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();

  const entries: SnapshotEntry[] = files.map((filename) => ({
    ...parseLeakedPromptFilename(filename),
    content: readFileSync(join(dir, filename), 'utf-8'),
  }));

  // Newest first, then by title for stable ordering within a date.
  entries.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  const snapshot = {
    sourceRepo: REPO,
    sourceCommit: sha,
    entryCount: entries.length,
    entries,
  };
  writeFileSync(OUT, `${JSON.stringify(snapshot)}\n`);
  console.log(`wrote ${entries.length} entries (${sha.slice(0, 7)}) → ${OUT}`);
}

main();
