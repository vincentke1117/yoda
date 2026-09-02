import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { buildTerminalFileLinkTrimVariants } from './terminal-file-link-variants';
import {
  narrowTerminalFileLinkMatch,
  type TerminalFileLinkMatch,
  type TerminalFileLinkOptions,
} from './terminal-file-links';

/**
 * Decide where an over-matched terminal path actually ends by asking the
 * filesystem, instead of refining the pattern again. The regex layer cannot
 * separate `.../活动.md（正文约 1.1` from `.../Agent 时代，我们需要怎样的 IDE.pdf`
 * because both readings are legal filenames; disk can.
 *
 * Verification only ever shrinks a match, and a candidate that resolves nowhere
 * keeps the pattern layer's verdict — terminals do print paths relative to
 * directories Yoda cannot see, and those clicks should still report a
 * diagnosable failure rather than stop being links.
 */

type ProbedPathKind = 'file' | 'directory' | null;

/** Mirrors the batch cap in `fs.probePaths`. */
const PROBE_BATCH_MAX = 32;
/**
 * Hover re-runs link detection on every row change, so verdicts must be cached.
 * The TTL keeps a freshly written file from staying unlinked for the session.
 */
const PROBE_CACHE_TTL_MS = 15_000;
const PROBE_CACHE_MAX_ENTRIES = 2000;

interface CachedProbe {
  kind: ProbedPathKind;
  expiresAt: number;
}

const probeCache = new Map<string, CachedProbe>();
const inFlightProbes = new Map<string, Promise<ProbedPathKind>>();

function cacheKey(path: string, sshConnectionId: string | undefined): string {
  return `${sshConnectionId ?? 'local'} ${path}`;
}

function readCache(key: string): ProbedPathKind | undefined {
  const cached = probeCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    probeCache.delete(key);
    return undefined;
  }
  return cached.kind;
}

function writeCache(key: string, kind: ProbedPathKind): void {
  // Map iteration is insertion-ordered, so the first key is the oldest write.
  if (probeCache.size >= PROBE_CACHE_MAX_ENTRIES) {
    const oldest = probeCache.keys().next();
    if (!oldest.done) probeCache.delete(oldest.value);
  }
  probeCache.set(key, { kind, expiresAt: Date.now() + PROBE_CACHE_TTL_MS });
}

/** Drop every cached verdict. Exported for tests and filesystem-changed resets. */
export function clearTerminalFileLinkVerificationCache(): void {
  probeCache.clear();
  inFlightProbes.clear();
}

interface MatchPlan {
  match: TerminalFileLinkMatch;
  /** Longest-first readings of `match`, each with the absolute path to probe. */
  readings: { match: TerminalFileLinkMatch; absolutePath: string }[];
}

function planMatch(match: TerminalFileLinkMatch): MatchPlan {
  const readings: MatchPlan['readings'] = [];
  for (const variant of buildTerminalFileLinkTrimVariants(match.text)) {
    const narrowed = variant === match.text ? match : narrowTerminalFileLinkMatch(match, variant);
    const absolutePath = narrowed?.target.absolutePath;
    if (narrowed && absolutePath) readings.push({ match: narrowed, absolutePath });
  }
  return { match, readings };
}

/**
 * Narrow each match onto the longest reading that exists on disk. Matches whose
 * only reading is the original, and matches with no absolute path to probe, are
 * returned untouched without any IPC.
 */
export async function verifyTerminalFileLinkMatches(
  matches: readonly TerminalFileLinkMatch[],
  options: Pick<TerminalFileLinkOptions, 'sshConnectionId'>
): Promise<TerminalFileLinkMatch[]> {
  const plans = matches.map(planMatch);
  const pending = new Set<string>();
  for (const plan of plans) {
    if (plan.readings.length < 2) continue;
    for (const reading of plan.readings) {
      const key = cacheKey(reading.absolutePath, options.sshConnectionId);
      if (readCache(key) === undefined) pending.add(reading.absolutePath);
    }
  }

  if (pending.size > 0) await probePaths([...pending], options.sshConnectionId);

  return plans.map((plan) => {
    if (plan.readings.length < 2) return plan.match;
    for (const reading of plan.readings) {
      if (readCache(cacheKey(reading.absolutePath, options.sshConnectionId))) return reading.match;
    }
    return plan.match;
  });
}

/**
 * Apply verdicts already in the cache without touching IPC, for the synchronous
 * hover/context-menu resolver. Hover detection normally warms the cache first,
 * so a right-click lands on the same narrowed target as the underline.
 */
export function applyCachedTerminalFileLinkVerification(
  match: TerminalFileLinkMatch,
  options: Pick<TerminalFileLinkOptions, 'sshConnectionId'>
): TerminalFileLinkMatch {
  const plan = planMatch(match);
  if (plan.readings.length < 2) return match;
  for (const reading of plan.readings) {
    const kind = readCache(cacheKey(reading.absolutePath, options.sshConnectionId));
    // An unprobed reading means the answer is still unknown, not "missing".
    if (kind === undefined) return match;
    if (kind) return reading.match;
  }
  return match;
}

async function probePaths(paths: string[], sshConnectionId: string | undefined): Promise<void> {
  const unclaimed = paths.filter((path) => !inFlightProbes.has(cacheKey(path, sshConnectionId)));
  for (let i = 0; i < unclaimed.length; i += PROBE_BATCH_MAX) {
    const batch = unclaimed.slice(i, i + PROBE_BATCH_MAX);
    const settled = runProbeBatch(batch, sshConnectionId);
    batch.forEach((path, index) => {
      inFlightProbes.set(
        cacheKey(path, sshConnectionId),
        settled.then((kinds) => kinds[index] ?? null)
      );
    });
  }

  await Promise.all(
    paths.map(async (path) => {
      const key = cacheKey(path, sshConnectionId);
      await inFlightProbes.get(key);
      inFlightProbes.delete(key);
    })
  );
}

async function runProbeBatch(
  paths: string[],
  sshConnectionId: string | undefined
): Promise<ProbedPathKind[]> {
  try {
    const result = await rpc.fs.probePaths(paths, sshConnectionId);
    if (!result.success) {
      log.warn('Terminal file link probe failed', { reason: result.error, count: paths.length });
      return paths.map(() => null);
    }
    const { kinds } = result.data;
    paths.forEach((path, index) => {
      writeCache(cacheKey(path, sshConnectionId), kinds[index] ?? null);
    });
    return kinds;
  } catch (error) {
    log.warn('Terminal file link probe threw', {
      reason: error instanceof Error ? error.message : String(error),
      count: paths.length,
    });
    return paths.map(() => null);
  }
}
