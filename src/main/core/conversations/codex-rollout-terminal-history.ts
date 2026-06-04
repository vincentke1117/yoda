import { readFile } from 'node:fs/promises';
import type { Conversation } from '@shared/conversations';
import { getCodexSessionContext } from './getCodexSessionContext';

const MAX_COMMAND_OUTPUT_CHARS = 16 * 1024;
const MAX_HISTORY_CHARS = 2 * 1024 * 1024;

type HistoryEntry = {
  timestamp: string | null;
  label: string;
  body: string;
};

type HistoryOptions = {
  threadId: string;
  title: string;
  rolloutPath: string;
};

export async function loadCodexRolloutTerminalHistoryForConversation({
  conversation,
  cwd,
}: {
  conversation: Conversation;
  cwd: string;
}): Promise<string | null> {
  if (conversation.providerId !== 'codex') return null;

  const context = await getCodexSessionContext(cwd, conversation.id, conversation.title);
  if (!context?.rolloutPath) return null;

  let raw: string;
  try {
    raw = await readFile(context.rolloutPath, 'utf8');
  } catch {
    return null;
  }

  const history = formatCodexRolloutTerminalHistory(raw, {
    threadId: context.threadId,
    title: context.title,
    rolloutPath: context.rolloutPath,
  });
  return history.trim() ? history : null;
}

export function formatCodexRolloutTerminalHistory(raw: string, options: HistoryOptions): string {
  const eventEntries: HistoryEntry[] = [];
  const responseEntries: HistoryEntry[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parsed = safeParse(line);
    if (!parsed) continue;
    const timestamp = nullableString(parsed.timestamp);

    if (parsed.type === 'event_msg') {
      const entry = parseEventHistoryEntry(parsed.payload, timestamp);
      if (entry) eventEntries.push(entry);
      continue;
    }

    if (parsed.type === 'response_item') {
      const entry = parseResponseHistoryEntry(parsed.payload, timestamp);
      if (entry) responseEntries.push(entry);
    }
  }

  const messageCount = eventEntries.filter(
    (entry) => entry.label === 'User' || entry.label === 'Codex'
  ).length;
  const entries = messageCount > 0 ? eventEntries : responseEntries;
  if (entries.length === 0) return '';

  const header = [
    'Codex history loaded from rollout transcript',
    `Thread: ${options.threadId}`,
    `Title: ${options.title}`,
    `Source: ${options.rolloutPath}`,
    '',
  ];
  const body = entries.map(formatEntry).join('\n');
  return limitHistory(`${header.join('\n')}${body}\n`);
}

function parseEventHistoryEntry(
  payloadValue: unknown,
  timestamp: string | null
): HistoryEntry | null {
  const payload = objectValue(payloadValue);
  if (!payload) return null;

  if (payload.type === 'user_message') {
    const message = nullableString(payload.message);
    return message ? { timestamp, label: 'User', body: message } : null;
  }

  if (payload.type === 'agent_message') {
    const message = nullableString(payload.message);
    return message ? { timestamp, label: 'Codex', body: message } : null;
  }

  if (payload.type === 'exec_command_end') {
    const command = formatCommand(payload.command);
    const output = extractCommandOutput(payload);
    const parts = [
      command ? `$ ${command}` : '$ command',
      output ? truncate(output, MAX_COMMAND_OUTPUT_CHARS) : null,
      formatExitStatus(payload),
    ].filter(Boolean);
    return { timestamp, label: 'Command', body: parts.join('\n') };
  }

  if (payload.type === 'task_started') {
    return { timestamp, label: 'Status', body: 'Task started' };
  }

  if (payload.type === 'task_complete') {
    return { timestamp, label: 'Status', body: 'Task complete' };
  }

  return null;
}

function parseResponseHistoryEntry(
  payloadValue: unknown,
  timestamp: string | null
): HistoryEntry | null {
  const payload = objectValue(payloadValue);
  if (!payload) return null;

  if (payload.type === 'message') {
    const role = nullableString(payload.role);
    if (role !== 'user' && role !== 'assistant') return null;

    const body = extractContentText(payload.content)?.trim();
    if (!body || isCodexEnvironmentMessage(body)) return null;
    return { timestamp, label: role === 'user' ? 'User' : 'Codex', body };
  }

  if (payload.type === 'function_call') {
    const name = nullableString(payload.name) ?? 'tool';
    const args = nullableString(payload.arguments);
    const body = args ? `${name} ${truncate(args, MAX_COMMAND_OUTPUT_CHARS)}` : name;
    return { timestamp, label: 'Tool call', body };
  }

  if (payload.type === 'function_call_output') {
    const output = nullableString(payload.output);
    return output
      ? { timestamp, label: 'Tool output', body: truncate(output, MAX_COMMAND_OUTPUT_CHARS) }
      : null;
  }

  return null;
}

function formatEntry(entry: HistoryEntry): string {
  const stamp = entry.timestamp ? ` ${entry.timestamp}` : '';
  return `[${entry.label}${stamp}]\n${entry.body.trimEnd()}\n`;
}

function formatCommand(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map((part) => shellQuote(String(part))).join(' ');
  }
  return nullableString(value);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function extractCommandOutput(payload: Record<string, unknown>): string | null {
  const aggregated = nullableString(payload.aggregated_output);
  if (aggregated) return aggregated;

  const formatted = nullableString(payload.formatted_output);
  if (formatted) return formatted;

  const stdout = nullableString(payload.stdout);
  const stderr = nullableString(payload.stderr);
  const combined = [stdout, stderr].filter(Boolean).join('\n');
  return combined.trim() ? combined : null;
}

function formatExitStatus(payload: Record<string, unknown>): string | null {
  const status = nullableString(payload.status);
  const exitCode = numberValue(payload.exit_code);
  if (status && typeof exitCode === 'number') return `[${status}, exit ${exitCode}]`;
  if (status) return `[${status}]`;
  if (typeof exitCode === 'number') return `[exit ${exitCode}]`;
  return null;
}

function extractContentText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    const obj = objectValue(block);
    if (!obj) continue;
    const text = nullableString(obj.text);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function isCodexEnvironmentMessage(text: string): boolean {
  return (
    text.startsWith('# AGENTS.md instructions for ') ||
    text.startsWith('<environment_context>') ||
    text.includes('\n<environment_context>')
  );
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[... truncated ${value.length - maxChars} chars]`;
}

function limitHistory(value: string): string {
  if (value.length <= MAX_HISTORY_CHARS) return value;
  const suffix = value.slice(value.length - MAX_HISTORY_CHARS);
  return `Codex history truncated to the latest ${MAX_HISTORY_CHARS} characters\n\n${suffix}`;
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line);
    return objectValue(parsed);
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function nullableString(value: unknown): string | null {
  const str = typeof value === 'string' ? value.trim() : null;
  return str ? str : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
