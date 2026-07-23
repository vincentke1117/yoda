import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import extractZip from '@electron-internal/extract-zip';
import type { ClawHubSkillSearchResult } from '@shared/skills/types';
import { downloadGitHubSkillDirectory } from './skill-assets';

const CLAWHUB_ORIGIN = 'https://clawhub.ai';
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ExtractLike = (zipPath: string, options: { dir: string }) => Promise<void>;

type ClawHubSearchPayload = {
  results?: unknown;
};

type ClawHubGitHubHandoff = {
  sourceRef: 'public-github';
  repo: string;
  commit: string;
  path: string;
};

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function clawHubSkillUrl(ownerHandle: string, slug: string): string {
  return `${CLAWHUB_ORIGIN}/${encodeURIComponent(ownerHandle)}/skills/${encodeURIComponent(slug)}`;
}

function parseSearchResult(value: unknown): ClawHubSkillSearchResult | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const slug = requiredString(raw.slug);
  const ownerHandle = requiredString(raw.ownerHandle);
  if (!slug || !ownerHandle) return null;
  const owner = raw.owner && typeof raw.owner === 'object' ? raw.owner : undefined;
  const ownerDisplayName = owner
    ? optionalString((owner as Record<string, unknown>).displayName)
    : undefined;
  return {
    source: 'clawhub',
    slug,
    displayName: optionalString(raw.displayName) ?? slug,
    description: optionalString(raw.summary) ?? '',
    ownerHandle,
    ownerDisplayName,
    version: optionalString(raw.version),
    downloads: typeof raw.downloads === 'number' ? raw.downloads : undefined,
    sourceUrl: clawHubSkillUrl(ownerHandle, slug),
  };
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.text().catch(() => '')).trim();
  const message = body || response.statusText || `HTTP ${response.status}`;
  return new Error(`ClawHub request failed (${response.status}): ${message}`);
}

function requestInit(accept: string): RequestInit {
  return {
    headers: {
      Accept: accept,
      'User-Agent': 'yoda-skills',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

export function clawHubSourceKey(ownerHandle: string, slug: string): string {
  return `clawhub:${ownerHandle}/${slug}`;
}

export async function searchClawHubSkills(
  query: string,
  limit = 20,
  fetchImpl: FetchLike = fetch
): Promise<ClawHubSkillSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];
  const url = new URL('/api/v1/search', CLAWHUB_ORIGIN);
  url.searchParams.set('q', normalizedQuery);
  url.searchParams.set('limit', String(Math.min(50, Math.max(1, Math.floor(limit)))));
  url.searchParams.set('nonSuspiciousOnly', 'true');
  const response = await fetchImpl(url.href, requestInit('application/json'));
  if (!response.ok) throw await responseError(response);
  const payload = (await response.json()) as ClawHubSearchPayload;
  if (!Array.isArray(payload.results)) return [];
  return payload.results
    .map(parseSearchResult)
    .filter((result): result is ClawHubSkillSearchResult => result !== null);
}

function parseGitHubHandoff(value: unknown): ClawHubGitHubHandoff | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.sourceRef !== 'public-github') return null;
  const repo = requiredString(raw.repo);
  const commit = requiredString(raw.commit);
  const directory = requiredString(raw.path);
  if (!repo || !commit || !directory) return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  if (!/^[A-Fa-f0-9]{7,64}$/.test(commit)) return null;
  return { sourceRef: 'public-github', repo, commit, path: directory };
}

export async function downloadClawHubSkill(
  args: { slug: string; ownerHandle: string; targetDir: string },
  dependencies: { fetchImpl?: FetchLike; extractImpl?: ExtractLike } = {}
): Promise<void> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const extractImpl = dependencies.extractImpl ?? extractZip;
  const url = new URL('/api/v1/download', CLAWHUB_ORIGIN);
  url.searchParams.set('slug', args.slug);
  url.searchParams.set('ownerHandle', args.ownerHandle);
  const response = await fetchImpl(
    url.href,
    requestInit('application/zip, application/json;q=0.9')
  );
  if (!response.ok) throw await responseError(response);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const handoff = parseGitHubHandoff(await response.json());
    if (!handoff) throw new Error('ClawHub returned an unsupported download handoff');
    await downloadGitHubSkillDirectory(
      `https://github.com/${handoff.repo}/tree/${handoff.commit}/${handoff.path}`,
      args.targetDir
    );
    return;
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`ClawHub skill package exceeds ${MAX_DOWNLOAD_BYTES} bytes`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`ClawHub skill package exceeds ${MAX_DOWNLOAD_BYTES} bytes`);
  }

  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yoda-clawhub-'));
  const archivePath = path.join(temporaryRoot, 'skill.zip');
  try {
    await fs.promises.writeFile(archivePath, archive);
    await extractImpl(archivePath, { dir: path.resolve(args.targetDir) });
    await fs.promises.access(path.join(args.targetDir, 'SKILL.md'));
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
  }
}
