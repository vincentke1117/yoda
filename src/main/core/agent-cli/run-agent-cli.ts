import { spawn } from 'node:child_process';
import { aiLogService } from '@main/core/ai-logs/ai-log-service';

const MAX_COMMAND_OUTPUT_CHARS = 32_000;
const MAX_COMMAND_ERROR_CHARS = 2_000;

export type AgentCliResult = {
  stdout: string;
  stderrChars: number;
};

export type RunAgentCliInput = {
  command: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  runtimeName: string;
  /** What this run is for — recorded in the AI invocation log. */
  purpose?: string;
  model?: string | null;
  metadata?: Record<string, string>;
  /**
   * Optional streaming callback. Fires with incremental answer text as the CLI
   * produces it — plain stdout for text-mode runs, or the growing tail of the
   * Codex `agent_message` for `--json` runs. Used for SSE-style summaries.
   */
  onDelta?: (delta: string) => void;
};

/**
 * Spawns a provider CLI non-interactively, feeds it a prompt, and captures
 * stdout. This is the one generic "run the agent CLI and read its answer"
 * primitive — the app has no LLM API client, so every AI-generated feature
 * (task naming, session summary, …) goes through here.
 *
 * Every run is recorded in the AI invocation log (start + finish), so slow
 * background jobs are observable from Settings → AI Logs while they run.
 *
 * For Codex `--json` runs the process is killed as soon as the final
 * `agent_message` event arrives, instead of waiting for the CLI to exit.
 */
export async function runAgentCli(input: RunAgentCliInput): Promise<AgentCliResult> {
  const logId = await aiLogService.start({
    purpose: input.purpose ?? 'utility',
    mode: 'cli',
    runtime: input.runtimeName,
    model: input.model ?? null,
    command: [input.command, ...input.args].join(' '),
    prompt: input.stdin ?? null,
    metadata: input.metadata,
  });
  try {
    const result = await spawnAgentCli(input);
    await aiLogService.finish(logId, {
      status: 'succeeded',
      output: extractAgentMessageText(result.stdout),
    });
    return result;
  } catch (error) {
    await aiLogService.finish(logId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function spawnAgentCli(input: RunAgentCliInput): Promise<AgentCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let stdoutLineBuffer = '';
    let timedOut = false;
    let settled = false;
    let emittedAgentMessage = '';
    const canResolveOnAgentMessage = input.command === 'codex' && input.args.includes('--json');

    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run();
    };
    const succeed = () => finish(() => resolve({ stdout, stderrChars: stderr.length }));
    const fail = (error: Error) => finish(() => reject(error));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);

    const append = (current: string, chunk: Buffer): string =>
      (current + chunk.toString('utf8')).slice(-MAX_COMMAND_OUTPUT_CHARS);

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout = (stdout + text).slice(-MAX_COMMAND_OUTPUT_CHARS);
      if (!canResolveOnAgentMessage) {
        // Text-mode (e.g. Claude --output-format text): stdout IS the answer.
        input.onDelta?.(text);
        return;
      }
      stdoutLineBuffer = inspectCodexJsonlChunk(
        stdoutLineBuffer + text,
        () => {
          succeed();
          child.kill();
        },
        input.onDelta
          ? (agentMessage) => {
              // Codex re-emits the full agent_message each tick; forward only
              // the newly-added tail so the renderer can append cleanly.
              if (agentMessage.startsWith(emittedAgentMessage)) {
                const delta = agentMessage.slice(emittedAgentMessage.length);
                if (delta) input.onDelta?.(delta);
              } else {
                input.onDelta?.(agentMessage);
              }
              emittedAgentMessage = agentMessage;
            }
          : undefined
      );
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      if (settled) return;
      if (timedOut) {
        fail(new Error(`${input.runtimeName} command timed out.`));
        return;
      }
      if (code !== 0) {
        fail(
          new Error(
            `${input.runtimeName} command failed: ${formatCommandFailure(stdout, stderr, code)}`
          )
        );
        return;
      }
      succeed();
    });

    child.stdin.end(input.stdin ?? '');
  });
}

/**
 * Extracts the final assistant message text from a CLI response. Handles
 * Codex JSONL (`agent_message` events) and plain stdout alike.
 */
export function extractAgentMessageText(raw: string): string {
  const codexMessage = extractCodexJsonlAgentMessage(raw);
  return (codexMessage ?? raw).trim();
}

function inspectCodexJsonlChunk(
  buffer: string,
  onFinalAgentMessage: () => void,
  onAgentMessageText?: (text: string) => void
): string {
  const lines = buffer.split(/\r?\n/);
  const tail = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isCodexAgentMessageEvent(event)) {
      const text = codexAgentMessageText(event);
      if (text && onAgentMessageText) onAgentMessageText(text);
      onFinalAgentMessage();
    }
  }
  return tail;
}

function codexAgentMessageText(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const item = (event as { item?: unknown }).item;
  if (!item || typeof item !== 'object') return null;
  const typed = item as { type?: unknown; text?: unknown };
  return typed.type === 'agent_message' && typeof typed.text === 'string' ? typed.text : null;
}

function extractCodexJsonlAgentMessage(raw: string): string | null {
  let finalMessage: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const item = (event as { item?: unknown }).item;
    if (!item || typeof item !== 'object') continue;
    const typedItem = item as { type?: unknown; text?: unknown };
    if (typedItem.type === 'agent_message' && typeof typedItem.text === 'string') {
      finalMessage = typedItem.text;
    }
  }
  return finalMessage;
}

function isCodexAgentMessageEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const item = (event as { item?: unknown }).item;
  if (!item || typeof item !== 'object') return false;
  return (item as { type?: unknown }).type === 'agent_message';
}

function formatCommandFailure(stdout: string, stderr: string, code: number | null): string {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n').trim();
  if (!combined) return `exit code ${code ?? 'unknown'}`;
  const explicitErrors = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        /^ERROR\b/i.test(line) ||
        /\binvalid_request_error\b/i.test(line) ||
        /"type":"error"/i.test(line)
    );
  const detail = explicitErrors.length > 0 ? explicitErrors.join('\n') : combined;
  return clipEnd(detail, MAX_COMMAND_ERROR_CHARS);
}

function clipEnd(value: string, max: number): string {
  if (value.length <= max) return value;
  return `...${value.slice(value.length - max + 3)}`;
}
