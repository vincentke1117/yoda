/**
 * Small, provider-agnostic text helpers shared between the renderer composer
 * and the main-process orchestrators. Kept here (not in a feature module) so
 * both surfaces import from one source instead of re-declaring them.
 */

/** Prefix a body with the agent's system prompt, if any. */
export function withSystemPrompt(systemPrompt: string, body: string): string {
  const trimmedSystemPrompt = systemPrompt.trim();
  if (!trimmedSystemPrompt) return body;
  return [`System prompt:`, trimmedSystemPrompt, '', body].join('\n');
}

/** Strip ANSI / OSC / control sequences so terminal output can be parsed as text. */
export function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/\r/g, '');
}
