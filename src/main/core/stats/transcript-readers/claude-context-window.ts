/**
 * Context-window sizes for Claude Code sessions, in tokens.
 *
 * Codex records its own window in every `token_count` event
 * (`info.model_context_window`); Claude Code records nothing, so the limit has
 * to come from a bundled table — Yoda has no API client to ask.
 *
 * Claude Code runs on the standard 200k window by default. Calibrated against
 * local transcripts: auto-compaction on `claude-opus-5` fires at 166k–173k
 * pre-tokens (200k minus the reserved output budget), while sessions with the
 * 1M context enabled reach 444k. So the window is inferred from what the
 * session actually used rather than assumed to be the model's maximum.
 *
 * Non-Claude models reached through an Anthropic-compatible endpoint
 * (`resolveRuntimeEnv` base-url overrides) land in these transcripts too. Their
 * window is a property of the model, not of usage, so a fixed-window table
 * wins over the usage inference below.
 */
export const CLAUDE_STANDARD_CONTEXT_WINDOW = 200_000;
const CLAUDE_EXTENDED_CONTEXT_WINDOW = 1_000_000;

/** Models offering the 1M context window. Prefix match against the model id. */
const EXTENDED_CONTEXT_MODEL_PREFIXES = [
  'claude-fable-5',
  'claude-mythos-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
];

/**
 * Models whose window is fixed regardless of how much the session has used.
 * `[1m]` / `[128k]` model-id suffixes are handled separately below, so entries
 * here cover models that ship a single window (verified 2026-08-21 against
 * live `deepseek-v4-*[1m]` sessions).
 */
const FIXED_CONTEXT_WINDOW_MODELS: readonly { prefixes: readonly string[]; window: number }[] = [
  { prefixes: ['deepseek-v4-'], window: 1_000_000 },
];

/**
 * A model-id window that holds unconditionally: an explicit `[1m]`/`[128k]`
 * suffix, or a known fixed-window model. `null` means the session's window has
 * to be inferred from usage instead.
 */
export function fixedContextWindowForModel(model: string | null): number | null {
  if (!model) return null;
  // Transcripts carry both `deepseek/deepseek-v4-pro` and `deepseek-v4-pro`.
  const normalized = model.trim().toLowerCase().replace(/^.*\//, '');
  const bracket = normalized.match(/\[(\d+(?:\.\d+)?)\s*(k|m)?\]/);
  if (bracket) {
    const value = parseFloat(bracket[1]);
    const unit = bracket[2] ?? '';
    if (unit === 'm') return Math.round(value * 1_000_000);
    if (unit === 'k') return Math.round(value * 1_000);
    return Math.round(value);
  }
  for (const entry of FIXED_CONTEXT_WINDOW_MODELS) {
    if (entry.prefixes.some((prefix) => normalized.startsWith(prefix))) return entry.window;
  }
  return null;
}

/**
 * The window the session is running under, given the largest context it is
 * known to have held. Exceeding the standard window means the 1M context is on;
 * for a model with no known 1M option we report what was actually used rather
 * than fabricate headroom or render past 100%.
 */
export function resolveClaudeContextWindow(model: string | null, peakTokens: number): number {
  const fixed = fixedContextWindowForModel(model);
  if (fixed !== null) return fixed;
  if (peakTokens <= CLAUDE_STANDARD_CONTEXT_WINDOW) return CLAUDE_STANDARD_CONTEXT_WINDOW;
  if (supportsExtendedContext(model)) return CLAUDE_EXTENDED_CONTEXT_WINDOW;
  return peakTokens;
}

function supportsExtendedContext(model: string | null): boolean {
  if (!model) return false;
  // Transcripts carry both `claude-opus-5` and `anthropic/claude-opus-5`.
  const normalized = model.trim().toLowerCase().replace(/^.*\//, '');
  return EXTENDED_CONTEXT_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
