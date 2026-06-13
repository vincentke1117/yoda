import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProbeResult } from './types';

const WHICH_TIMEOUT_MS = 5_000;
const VERSION_PROBE_TIMEOUT_MS = 10_000;

// `where` on Windows, `which` on macOS/Linux
const RESOLVE_CMD = process.platform === 'win32' ? 'where' : 'which';

/**
 * Common bin directories that hold user-installed CLIs but are frequently
 * absent from the PATH a GUI-launched (launchd / Finder) Electron process
 * inherits. When `which`/`where` comes up empty — typically because the
 * login-shell PATH capture (resolveUserEnv) timed out or was skipped — we
 * scan these directly so tools like `claude`, `codex`, and `tmux` are still
 * detected instead of being reported as missing.
 *
 * `~/.nvm/versions/node/*` is expanded at probe time since the active Node
 * version directory is dynamic.
 */
function knownBinDirs(): string[] {
  const home = os.homedir();
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.deno', 'bin'),
    path.join(home, 'go', 'bin'),
  ];

  // Expand every installed nvm Node version's bin dir.
  const nvmVersionsDir = path.join(home, '.nvm', 'versions', 'node');
  try {
    for (const entry of fs.readdirSync(nvmVersionsDir)) {
      dirs.push(path.join(nvmVersionsDir, entry, 'bin'));
    }
  } catch {
    // No nvm install — ignore.
  }

  return dirs;
}

/**
 * Fallback resolution by scanning well-known bin directories on disk.
 * Local execution contexts only — for SSH we can't stat the remote FS here.
 * Returns the first existing, executable match, or `null`.
 */
function resolveFromKnownDirs(command: string): string | null {
  if (process.platform === 'win32') return null;
  for (const dir of knownBinDirs()) {
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not here — keep scanning.
    }
  }
  return null;
}

/**
 * Resolves the absolute path of a command binary.
 * Uses `where` on Windows and `which` on macOS/Linux. When that fails on a
 * local context, scans {@link knownBinDirs} as a fallback so GUI-launched
 * apps with a stunted PATH still find user-installed CLIs.
 * Returns `null` if the command cannot be found.
 */
export async function resolveCommandPath(
  command: string,
  ctx: IExecutionContext
): Promise<string | null> {
  try {
    const { stdout } = await ctx.exec(RESOLVE_CMD, [command], { timeout: WHICH_TIMEOUT_MS });
    const firstLine = stdout.trim().split('\n')[0]?.trim();
    if (firstLine) return firstLine;
  } catch {
    // Fall through to the disk scan below.
  }

  return ctx.supportsLocalSpawn ? resolveFromKnownDirs(command) : null;
}

/**
 * Runs `command args` and collects stdout/stderr up to a timeout.
 * Never throws — all failures are captured in the returned `ProbeResult`.
 */
export async function runVersionProbe(
  command: string,
  resolvedPath: string | null,
  args: string[],
  ctx: IExecutionContext,
  timeoutMs: number = VERSION_PROBE_TIMEOUT_MS
): Promise<ProbeResult> {
  const bin = resolvedPath ?? command;
  try {
    const { stdout, stderr } = await ctx.exec(bin, args, { timeout: timeoutMs });
    return { command, path: resolvedPath, stdout, stderr, exitCode: 0, timedOut: false };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    return {
      command,
      path: resolvedPath,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? null,
      timedOut: !!e.killed,
    };
  }
}
