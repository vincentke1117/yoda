import { describe, expect, it } from 'vitest';
import { resolveProviderEnv, resolveProviderTmuxEnv } from './provider-env';

describe('resolveProviderEnv', () => {
  it('returns valid provider environment variables', () => {
    expect(
      resolveProviderEnv({
        env: {
          ANTHROPIC_BASE_URL: 'https://example.test',
          _TOKEN: 'secret',
          'INVALID-NAME': 'ignored',
          '1TOKEN': 'ignored',
        },
      })
    ).toEqual({
      ANTHROPIC_BASE_URL: 'https://example.test',
      _TOKEN: 'secret',
    });
  });

  it('returns undefined when no valid provider environment variables exist', () => {
    expect(resolveProviderEnv(undefined)).toBeUndefined();
    expect(resolveProviderEnv({ env: { 'INVALID-NAME': 'ignored' } })).toBeUndefined();
  });

  it('forces Claude Code classic rendering inside tmux', () => {
    expect(resolveProviderEnv(undefined, { providerId: 'claude', tmuxEnabled: true })).toEqual({
      CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
    });
  });

  it('does not force classic rendering for non-tmux or non-Claude sessions', () => {
    expect(
      resolveProviderEnv(undefined, { providerId: 'claude', tmuxEnabled: false })
    ).toBeUndefined();
    expect(
      resolveProviderEnv(undefined, { providerId: 'codex', tmuxEnabled: true })
    ).toBeUndefined();
  });

  it('preserves explicit Claude alternate screen environment overrides', () => {
    expect(
      resolveProviderEnv(
        {
          env: {
            CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '0',
          },
        },
        { providerId: 'claude', tmuxEnabled: true }
      )
    ).toEqual({
      CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '0',
    });
  });

  it('limits tmux environment propagation to safe renderer variables', () => {
    expect(
      resolveProviderTmuxEnv({
        CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
        ANTHROPIC_API_KEY: 'secret',
      })
    ).toEqual({
      CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
    });
  });
});
