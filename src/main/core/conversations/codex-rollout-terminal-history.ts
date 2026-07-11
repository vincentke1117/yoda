import { readFile } from 'node:fs/promises';
import type { Conversation } from '@shared/conversations';
import { getCodexSessionContext } from './getCodexSessionContext';

const MAX_COMMAND_OUTPUT_CHARS = 16 * 1024;
const MAX_HISTORY_CHARS = 2 * 1024 * 1024;

type HistoryEntry = {
  order: number;
  timestamp: string | null;
  kind: 'message' | 'tool' | 'status';
  label: string;
  body: string;
};

type SequencedTranscriptEntry = {
  order: number;
  entry: CodexRolloutTranscriptEntry;
};

type ParsedResponseTranscriptEntry = SequencedTranscriptEntry & {
  callId?: string;
  outputForCallId?: string;
};

export type CodexRolloutTranscriptEntryRole = 'user' | 'assistant' | 'tool' | 'status';

export type CodexRolloutTranscriptEntry = {
  id: string;
  timestamp: string | null;
  role: CodexRolloutTranscriptEntryRole;
  title?: string;
  format: 'markdown' | 'code' | 'plain';
  content: string;
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
  if (conversation.runtimeId !== 'codex') return null;

  const context = await getCodexSessionContext(
    cwd,
    conversation.id,
    conversation.title,
    conversation.createdAt
  );
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

export async function loadCodexRolloutTranscriptForConversation({
  conversation,
  cwd,
}: {
  conversation: Conversation;
  cwd: string;
}): Promise<CodexRolloutTranscriptEntry[] | null> {
  if (conversation.runtimeId !== 'codex') return null;

  const context = await getCodexSessionContext(
    cwd,
    conversation.id,
    conversation.title,
    conversation.createdAt
  );
  if (!context?.rolloutPath) return null;

  let raw: string;
  try {
    raw = await readFile(context.rolloutPath, 'utf8');
  } catch {
    return null;
  }

  const transcript = parseCodexRolloutTranscript(raw);
  return transcript.length > 0 ? transcript : null;
}

export function formatCodexRolloutTerminalHistory(raw: string, options: HistoryOptions): string {
  const eventEntries: HistoryEntry[] = [];
  const responseEntries: HistoryEntry[] = [];
  let order = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const currentOrder = order;
    order += 1;
    const parsed = safeParse(line);
    if (!parsed) continue;
    const timestamp = nullableString(parsed.timestamp);

    if (parsed.type === 'event_msg') {
      const entry = parseEventHistoryEntry(parsed.payload, timestamp, currentOrder);
      if (entry) eventEntries.push(entry);
      continue;
    }

    if (parsed.type === 'response_item') {
      const entry = parseResponseHistoryEntry(parsed.payload, timestamp, currentOrder);
      if (entry) responseEntries.push(entry);
    }
  }

  const messageCount = eventEntries.filter((entry) => entry.kind === 'message').length;
  const responseTools = responseEntries.filter((entry) => entry.kind === 'tool');
  const entries = (
    messageCount > 0
      ? responseTools.length > 0
        ? [...eventEntries.filter((entry) => entry.kind !== 'tool'), ...responseTools]
        : eventEntries
      : responseEntries
  ).sort((a, b) => a.order - b.order);
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

export function parseCodexRolloutTranscript(raw: string): CodexRolloutTranscriptEntry[] {
  const eventEntries: SequencedTranscriptEntry[] = [];
  const responseEntries: SequencedTranscriptEntry[] = [];
  const responseToolCalls = new Map<string, CodexRolloutTranscriptEntry>();
  let order = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const currentOrder = order;
    order += 1;
    const parsed = safeParse(line);
    if (!parsed) continue;
    const timestamp = nullableString(parsed.timestamp);

    if (parsed.type === 'event_msg') {
      const entry = parseEventTranscriptEntry(parsed.payload, timestamp, currentOrder);
      if (entry) eventEntries.push({ order: currentOrder, entry });
      continue;
    }

    if (parsed.type === 'response_item') {
      const parsedEntry = parseResponseTranscriptEntry(parsed.payload, timestamp, currentOrder);
      if (!parsedEntry) continue;

      if (parsedEntry.outputForCallId) {
        const toolCall = responseToolCalls.get(parsedEntry.outputForCallId);
        if (toolCall) {
          toolCall.content = `${toolCall.content}\n\nOutput:\n${parsedEntry.entry.content}`;
          continue;
        }
      }

      responseEntries.push(parsedEntry);
      if (parsedEntry.callId) {
        responseToolCalls.set(parsedEntry.callId, parsedEntry.entry);
      }
    }
  }

  const messageCount = eventEntries.filter(
    ({ entry }) => entry.role === 'user' || entry.role === 'assistant'
  ).length;
  const responseTools = responseEntries.filter(({ entry }) => entry.role === 'tool');
  const entries = (
    messageCount > 0
      ? responseTools.length > 0
        ? [...eventEntries.filter(({ entry }) => entry.role !== 'tool'), ...responseTools]
        : eventEntries
      : responseEntries
  )
    .sort((a, b) => a.order - b.order)
    .map(({ entry }) => entry);

  return compactIncrementalAssistantBlocks(entries);
}

function compactIncrementalAssistantBlocks(
  blocks: CodexRolloutTranscriptEntry[]
): CodexRolloutTranscriptEntry[] {
  const compacted: CodexRolloutTranscriptEntry[] = [];
  for (const block of blocks) {
    const previous = compacted.at(-1);
    if (
      previous &&
      previous.role === 'assistant' &&
      block.role === 'assistant' &&
      (previous.format === 'markdown' || previous.format === 'plain') &&
      (block.format === 'markdown' || block.format === 'plain')
    ) {
      previous.content = `${previous.content}\n\n${block.content}`;
      previous.format =
        previous.format === 'markdown' || block.format === 'markdown' ? 'markdown' : 'plain';
    } else {
      compacted.push({ ...block });
    }
  }
  return compacted;
}

function parseEventHistoryEntry(
  payloadValue: unknown,
  timestamp: string | null,
  order: number
): HistoryEntry | null {
  const payload = objectValue(payloadValue);
  if (!payload) return null;

  if (payload.type === 'user_message') {
    const message = nullableString(payload.message);
    return message ? { order, timestamp, kind: 'message', label: 'User', body: message } : null;
  }

  if (payload.type === 'agent_message') {
    const message = nullableString(payload.message);
    return message ? { order, timestamp, kind: 'message', label: 'Codex', body: message } : null;
  }

  if (payload.type === 'exec_command_end') {
    const command = formatCommand(payload.command);
    const output = extractCommandOutput(payload);
    const parts = [
      command ? `$ ${command}` : '$ command',
      output ? truncate(output, MAX_COMMAND_OUTPUT_CHARS) : null,
      formatExitStatus(payload),
    ].filter(Boolean);
    return { order, timestamp, kind: 'tool', label: 'Command', body: parts.join('\n') };
  }

  if (payload.type === 'patch_apply_end') {
    const output = extractCommandOutput(payload);
    return {
      order,
      timestamp,
      kind: 'tool',
      label: 'Edit files',
      body: output ? truncate(output, MAX_COMMAND_OUTPUT_CHARS) : 'File edit completed',
    };
  }

  if (payload.type === 'task_started') {
    return { order, timestamp, kind: 'status', label: 'Status', body: 'Task started' };
  }

  if (payload.type === 'task_complete') {
    return { order, timestamp, kind: 'status', label: 'Status', body: 'Task complete' };
  }

  return null;
}

function parseEventTranscriptEntry(
  payloadValue: unknown,
  timestamp: string | null,
  index: number
): CodexRolloutTranscriptEntry | null {
  const payload = objectValue(payloadValue);
  if (!payload) return null;

  if (payload.type === 'user_message') {
    const message = nullableString(payload.message);
    return message
      ? transcriptEntry({ index, timestamp, role: 'user', title: 'You', content: message })
      : null;
  }

  if (payload.type === 'agent_message') {
    const message = nullableString(payload.message);
    return message
      ? transcriptEntry({
          index,
          timestamp,
          role: 'assistant',
          title: 'Codex',
          content: message,
        })
      : null;
  }

  if (payload.type === 'exec_command_end') {
    const command = formatCommand(payload.command);
    const output = extractCommandOutput(payload);
    const status = formatExitStatus(payload);
    const parts = [
      command ? `$ ${command}` : '$ command',
      output ? truncate(output, MAX_COMMAND_OUTPUT_CHARS) : null,
      status,
    ].filter(Boolean);
    return transcriptEntry({
      index,
      timestamp,
      role: 'tool',
      title: 'Command',
      format: 'code',
      content: parts.join('\n'),
    });
  }

  if (payload.type === 'patch_apply_end') {
    const output = extractCommandOutput(payload);
    return transcriptEntry({
      index,
      timestamp,
      role: 'tool',
      title: 'Edit files',
      format: 'code',
      content: output ? truncate(output, MAX_COMMAND_OUTPUT_CHARS) : 'File edit completed',
    });
  }

  if (payload.type === 'task_started') {
    return transcriptEntry({
      index,
      timestamp,
      role: 'status',
      title: 'Status',
      format: 'plain',
      content: 'Task started',
    });
  }

  if (payload.type === 'task_complete') {
    return transcriptEntry({
      index,
      timestamp,
      role: 'status',
      title: 'Status',
      format: 'plain',
      content: 'Task complete',
    });
  }

  return null;
}

function parseResponseHistoryEntry(
  payloadValue: unknown,
  timestamp: string | null,
  order: number
): HistoryEntry | null {
  const payload = objectValue(payloadValue);
  if (!payload) return null;

  if (payload.type === 'message') {
    const role = nullableString(payload.role);
    if (role !== 'user' && role !== 'assistant') return null;

    const body = extractContentText(payload.content)?.trim();
    if (!body || isCodexEnvironmentMessage(body)) return null;
    return {
      order,
      timestamp,
      kind: 'message',
      label: role === 'user' ? 'User' : 'Codex',
      body,
    };
  }

  if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
    const name = nullableString(payload.name) ?? 'tool';
    const input = extractToolInput(payload.arguments ?? payload.input);
    return {
      order,
      timestamp,
      kind: 'tool',
      label: toolDisplayName(name, input),
      body: input ? truncate(input, MAX_COMMAND_OUTPUT_CHARS) : name,
    };
  }

  if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
    const output = extractToolOutputText(payload.output);
    return output
      ? {
          order,
          timestamp,
          kind: 'tool',
          label: 'Tool output',
          body: truncate(output, MAX_COMMAND_OUTPUT_CHARS),
        }
      : null;
  }

  return null;
}

function parseResponseTranscriptEntry(
  payloadValue: unknown,
  timestamp: string | null,
  index: number
): ParsedResponseTranscriptEntry | null {
  const payload = objectValue(payloadValue);
  if (!payload) return null;

  if (payload.type === 'message') {
    const role = nullableString(payload.role);
    if (role !== 'user' && role !== 'assistant') return null;

    const content = extractContentText(payload.content)?.trim();
    if (!content || isCodexEnvironmentMessage(content)) return null;
    return {
      order: index,
      entry: transcriptEntry({
        index,
        timestamp,
        role: role === 'user' ? 'user' : 'assistant',
        title: role === 'user' ? 'You' : 'Codex',
        content,
      }),
    };
  }

  if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
    const name = nullableString(payload.name) ?? 'tool';
    const input = extractToolInput(payload.arguments ?? payload.input);
    return {
      order: index,
      callId: nullableString(payload.call_id) ?? undefined,
      entry: transcriptEntry({
        index,
        timestamp,
        role: 'tool',
        title: toolDisplayName(name, input),
        format: 'code',
        content: input ? truncate(input, MAX_COMMAND_OUTPUT_CHARS) : name,
      }),
    };
  }

  if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
    const output = extractToolOutputText(payload.output);
    const callId = nullableString(payload.call_id) ?? undefined;
    return output
      ? {
          order: index,
          outputForCallId: callId,
          entry: transcriptEntry({
            index,
            timestamp,
            role: 'tool',
            title: 'Tool output',
            format: 'code',
            content: truncate(output, MAX_COMMAND_OUTPUT_CHARS),
          }),
        }
      : null;
  }

  return null;
}

function transcriptEntry({
  index,
  timestamp,
  role,
  title,
  format = 'markdown',
  content,
}: {
  index: number;
  timestamp: string | null;
  role: CodexRolloutTranscriptEntryRole;
  title?: string;
  format?: CodexRolloutTranscriptEntry['format'];
  content: string;
}): CodexRolloutTranscriptEntry {
  return {
    id: `${timestamp ?? 'no-time'}-${role}-${index}`,
    timestamp,
    role,
    title,
    format,
    content: content.trimEnd(),
  };
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

function extractToolInput(value: unknown): string | null {
  if (typeof value === 'string') return nullableString(value);
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(
      value,
      (_key, item: unknown) =>
        typeof item === 'string' && item.startsWith('data:') ? '[embedded data omitted]' : item,
      2
    );
  } catch {
    return String(value);
  }
}

function extractToolOutputText(value: unknown): string | null {
  if (typeof value === 'string') return nullableString(value);
  if (!Array.isArray(value)) return extractToolInput(value);

  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const text = nullableString(item);
      if (text) parts.push(text);
      continue;
    }

    const block = objectValue(item);
    if (!block) continue;
    const type = nullableString(block.type) ?? '';
    const text = nullableString(block.text);
    if (text) {
      parts.push(text);
      continue;
    }
    if (type.includes('image') || block.image_url !== undefined) {
      parts.push('[Image output omitted]');
    }
  }
  return nullableString(parts.join('\n'));
}

function toolDisplayName(name: string, input: string | null): string {
  if (name === 'exec') {
    if (input?.includes('tools.apply_patch')) return 'Edit files';
    if (input?.includes('tools.exec_command')) return 'Run command';
    if (input?.includes('tools.view_image')) return 'View image';
    if (input?.includes('tools.update_plan')) return 'Update plan';
    if (input?.includes('tools.web__run')) return 'Browse web';
    if (input?.includes('tools.image_gen')) return 'Generate image';
  }

  const labels: Record<string, string> = {
    apply_patch: 'Edit files',
    exec_command: 'Run command',
    followup_task: 'Continue sub-agent',
    request_user_input: 'Request input',
    spawn_agent: 'Start sub-agent',
    update_plan: 'Update plan',
    view_image: 'View image',
    wait_agent: 'Wait for sub-agent',
  };
  return labels[name] ?? `Tool · ${name}`;
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
