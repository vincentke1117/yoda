import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { ClaudeStatuslineConfig } from '@shared/conversations';

/**
 * Claude Code resolves `statusLine` from its settings files with
 * local > project > user precedence. We mirror that scan so the panel shows
 * the EFFECTIVE statusline, and template switches write back into the file
 * that currently defines it (falling back to ~/.claude/settings.json).
 */
function settingsSources(cwd: string) {
  return [
    { kind: 'local' as const, path: join(cwd, '.claude', 'settings.local.json') },
    { kind: 'project' as const, path: join(cwd, '.claude', 'settings.json') },
    { kind: 'user' as const, path: join(homedir(), '.claude', 'settings.json') },
  ];
}

async function readSettingsFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function statuslineCommand(settings: Record<string, unknown>): string | null {
  const statusLine = settings.statusLine;
  if (!statusLine || typeof statusLine !== 'object') return null;
  const command = (statusLine as Record<string, unknown>).command;
  return typeof command === 'string' && command.trim() ? command : null;
}

/**
 * When the command is just a script invocation (optionally through an
 * interpreter, e.g. `bash ~/.claude/statusline.sh`), resolve the script to an
 * absolute path so file actions can target the script itself rather than the
 * settings file. Multi-token shell one-liners resolve to null.
 */
async function resolveCommandScriptPath(command: string): Promise<string | null> {
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0 || tokens.length > 2) return null;
  const candidate = tokens[tokens.length - 1];
  if (!candidate.includes('/')) return null;
  const expanded = candidate.startsWith('~/') ? join(homedir(), candidate.slice(2)) : candidate;
  if (!isAbsolute(expanded)) return null;
  try {
    await access(expanded);
    return expanded;
  } catch {
    return null;
  }
}

export async function getClaudeStatusline(cwd: string): Promise<ClaudeStatuslineConfig> {
  for (const source of settingsSources(cwd)) {
    const settings = await readSettingsFile(source.path);
    if (!settings) continue;
    const command = statuslineCommand(settings);
    if (command) {
      return {
        command,
        commandScriptPath: await resolveCommandScriptPath(command),
        sourceKind: source.kind,
        sourcePath: source.path,
      };
    }
  }
  return { command: null, commandScriptPath: null, sourceKind: null, sourcePath: null };
}

export async function setClaudeStatusline(
  cwd: string,
  command: string
): Promise<ClaudeStatuslineConfig> {
  const sources = settingsSources(cwd);
  // Write where the active statusLine is defined so the switch takes effect
  // despite precedence; with no existing config, default to the user file.
  let target = sources[sources.length - 1];
  for (const source of sources) {
    const settings = await readSettingsFile(source.path);
    if (settings && statuslineCommand(settings)) {
      target = source;
      break;
    }
  }

  const existing = (await readSettingsFile(target.path)) ?? {};
  const prev =
    existing.statusLine && typeof existing.statusLine === 'object'
      ? (existing.statusLine as Record<string, unknown>)
      : {};
  existing.statusLine = { ...prev, type: 'command', command };
  await mkdir(dirname(target.path), { recursive: true });
  await writeFile(target.path, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  return {
    command,
    commandScriptPath: await resolveCommandScriptPath(command),
    sourceKind: target.kind,
    sourcePath: target.path,
  };
}
