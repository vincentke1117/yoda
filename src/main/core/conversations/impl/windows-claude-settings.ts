import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimeId } from '@shared/runtime-registry';

type SettingsFileOptions = {
  platform?: NodeJS.Platform;
  mkdtemp?: (prefix: string) => string;
  writeFile?: (
    filePath: string,
    content: string,
    options: { encoding: 'utf8'; flag: 'wx'; mode: number }
  ) => void;
  removeDirectory?: (dirPath: string) => void;
};

export type PreparedWindowsClaudeSettings = {
  args: string[];
  settingsPath?: string;
  cleanup?: () => void;
};

/**
 * CMD.exe cannot reliably preserve quotes in Claude's inline `--settings` JSON.
 * Materialize only inline JSON at the local Windows spawn boundary so SSH keeps
 * the transport-safe inline argument produced by the pure command builder.
 */
export function prepareWindowsClaudeSettings(
  runtimeId: RuntimeId,
  args: string[],
  options: SettingsFileOptions = {}
): PreparedWindowsClaudeSettings {
  if ((options.platform ?? process.platform) !== 'win32' || runtimeId !== 'claude') {
    return { args };
  }

  const settingsIndex = args.lastIndexOf('--settings');
  const inlineSettings = settingsIndex >= 0 ? args[settingsIndex + 1] : undefined;
  if (!inlineSettings) return { args };

  try {
    const parsed = JSON.parse(inlineSettings) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { args };
  } catch {
    // A path or malformed value belongs to the caller; leave it untouched.
    return { args };
  }

  const mkdtemp = options.mkdtemp ?? mkdtempSync;
  const writeFile = options.writeFile ?? writeFileSync;
  const removeDirectory =
    options.removeDirectory ??
    ((dirPath: string) => rmSync(dirPath, { recursive: true, force: true }));
  const settingsDir = mkdtemp(path.win32.join(tmpdir(), 'yoda-claude-settings-'));
  const settingsPath = path.win32.join(settingsDir, 'settings.json');

  try {
    writeFile(settingsPath, inlineSettings, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    removeDirectory(settingsDir);
    throw error;
  }

  const preparedArgs = [...args];
  preparedArgs[settingsIndex + 1] = settingsPath;
  let cleaned = false;

  return {
    args: preparedArgs,
    settingsPath,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      removeDirectory(settingsDir);
    },
  };
}
