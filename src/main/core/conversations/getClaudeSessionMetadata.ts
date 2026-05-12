import { readFile } from 'node:fs/promises';
import type { ClaudeSessionMetadata, ClaudeTodo, ClaudeTodoStatus } from '@shared/conversations';
import { resolveClaudeTranscriptPath } from '@main/core/session-title/claude-title-source';
import { log } from '@main/lib/logger';

/**
 * Reads the Claude Code transcript at ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * and extracts the current task list, the latest `/compact` summary, and the most recent
 * assistant model id. Returns null if the file is missing.
 *
 * CC tracks tasks via two tool surfaces, both supported here:
 *   - Legacy: a single `TodoWrite` tool_use with a full `todos` array. Each call overwrites.
 *   - Current (CC ≥ v2.1): `TaskCreate { subject, description, activeForm }` appends a task
 *     with an implicit sequential id ("1", "2", ...), and `TaskUpdate { taskId, status }`
 *     mutates an existing task's status.
 *
 * If both surfaces appear in a single transcript, the newer TaskCreate/TaskUpdate state wins.
 * Callers poll; we re-read the whole file each tick (KISS — sessions are kilobytes-to-MB).
 */
export async function getClaudeSessionMetadata(
  cwd: string,
  sessionId: string
): Promise<ClaudeSessionMetadata | null> {
  const filePath = resolveClaudeTranscriptPath(cwd, sessionId);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  let summary: string | null = null;
  let legacyTodos: ClaudeTodo[] | null = null;
  let model: string | null = null;

  const taskById = new Map<string, ClaudeTodo>();
  const taskOrder: string[] = [];
  let taskCreateCount = 0;

  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;

    if (line.includes('"type":"summary"')) {
      const parsed = safeParse(line);
      if (parsed && parsed.type === 'summary' && typeof parsed.summary === 'string') {
        const t = parsed.summary.trim();
        if (t) summary = t;
      }
      continue;
    }

    const hasTodoWrite = line.includes('"name":"TodoWrite"');
    const hasTaskCreate = line.includes('"name":"TaskCreate"');
    const hasTaskUpdate = line.includes('"name":"TaskUpdate"');
    const hasAssistantModel = line.includes('"role":"assistant"') && line.includes('"model"');

    if (!hasTodoWrite && !hasTaskCreate && !hasTaskUpdate && !hasAssistantModel) continue;

    const parsed = safeParse(line);
    if (!parsed) continue;

    if (hasAssistantModel) {
      const m = extractModel(parsed);
      if (m) model = m;
    }

    const toolUses = extractToolUses(parsed);
    for (const block of toolUses) {
      if (block.name === 'TodoWrite') {
        const todos = parseTodoWriteInput(block.input);
        if (todos) legacyTodos = todos;
      } else if (block.name === 'TaskCreate') {
        const todo = parseTaskCreateInput(block.input);
        if (todo) {
          taskCreateCount += 1;
          const id = String(taskCreateCount);
          taskById.set(id, todo);
          taskOrder.push(id);
        }
      } else if (block.name === 'TaskUpdate') {
        const update = parseTaskUpdateInput(block.input);
        if (update) {
          const existing = taskById.get(update.taskId);
          if (existing) existing.status = update.status;
        }
      }
    }
  }

  const todos =
    taskOrder.length > 0 ? taskOrder.map((id) => taskById.get(id)!) : (legacyTodos ?? []);

  return { summary, todos, model };
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch (err) {
    log.debug('getClaudeSessionMetadata: parse failed', { error: String(err) });
    return null;
  }
}

type ToolUseBlock = { name: string; input: unknown };

function extractToolUses(row: Record<string, unknown>): ToolUseBlock[] {
  const message = row.message;
  if (!message || typeof message !== 'object') return [];
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  const out: ToolUseBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type !== 'tool_use') continue;
    if (typeof b.name !== 'string') continue;
    out.push({ name: b.name, input: b.input });
  }
  return out;
}

function parseTodoWriteInput(input: unknown): ClaudeTodo[] | null {
  if (!input || typeof input !== 'object') return null;
  const arr = (input as Record<string, unknown>).todos;
  if (!Array.isArray(arr)) return null;
  const todos: ClaudeTodo[] = [];
  for (const t of arr) {
    if (!t || typeof t !== 'object') continue;
    const rec = t as Record<string, unknown>;
    const c = typeof rec.content === 'string' ? rec.content : '';
    if (!c) continue;
    todos.push({
      content: c,
      activeForm: typeof rec.activeForm === 'string' ? rec.activeForm : undefined,
      status: normalizeStatus(rec.status),
    });
  }
  return todos;
}

function parseTaskCreateInput(input: unknown): ClaudeTodo | null {
  if (!input || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  const subject = typeof rec.subject === 'string' ? rec.subject : '';
  if (!subject) return null;
  return {
    content: subject,
    activeForm: typeof rec.activeForm === 'string' ? rec.activeForm : undefined,
    status: 'pending',
  };
}

function parseTaskUpdateInput(input: unknown): { taskId: string; status: ClaudeTodoStatus } | null {
  if (!input || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  const taskId = typeof rec.taskId === 'string' ? rec.taskId : '';
  if (!taskId) return null;
  return { taskId, status: normalizeStatus(rec.status) };
}

function normalizeStatus(value: unknown): ClaudeTodoStatus {
  return value === 'in_progress' || value === 'completed' ? value : 'pending';
}

function extractModel(row: Record<string, unknown>): string | null {
  const message = row.message;
  if (!message || typeof message !== 'object') return null;
  const m = (message as Record<string, unknown>).model;
  return typeof m === 'string' && m.length > 0 ? m : null;
}
