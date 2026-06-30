import { describe, expect, it } from 'vitest';
import { getDefaultForKey } from './settings-registry';

describe('settings defaults', () => {
  it('enables tmux by default', () => {
    expect(getDefaultForKey('project').tmuxByDefault).toBe(true);
  });

  it('keeps input prompts in their original language by default', () => {
    expect(getDefaultForKey('tasks').inputPromptLanguage).toBe('prompt');
  });
});
