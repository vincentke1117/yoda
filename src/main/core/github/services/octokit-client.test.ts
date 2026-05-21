import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitHubOctokit } from './octokit-client';

describe('createGitHubOctokit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not write Octokit request logs to stderr', () => {
    const stderrError = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      throw stderrError;
    });

    const octokit = createGitHubOctokit('gho_test');

    expect(() => octokit.log.error('GET /user - 500 with id UNKNOWN in 1ms')).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
