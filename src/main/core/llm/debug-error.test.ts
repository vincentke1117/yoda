import { describe, expect, it } from 'vitest';
import { summarizeLlmDebugError } from './debug-error';

describe('summarizeLlmDebugError', () => {
  it('extracts the nested API error from Codex JSONL output', () => {
    const nestedError = JSON.stringify({
      type: 'error',
      status: 400,
      error: {
        type: 'invalid_request_error',
        message:
          "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
      },
    });
    const error = [
      'Codex naming command failed: {"type":"item.completed","item":{"id":"item_0","type":"error","message":"Ignored unsupported project-local config keys."}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"error","message":"Skill descriptions were shortened."}}',
      JSON.stringify({ type: 'error', message: nestedError }),
      JSON.stringify({ type: 'turn.failed', error: { message: nestedError } }),
    ].join('\n');

    expect(summarizeLlmDebugError(error)).toBe(
      "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account."
    );
  });
});
