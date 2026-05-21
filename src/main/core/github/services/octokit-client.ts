import { Octokit } from '@octokit/rest';

type OctokitLog = {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
};

const noop = (): void => {};

const quietOctokitLog: OctokitLog = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

export function createGitHubOctokit(auth: string): Octokit {
  return new Octokit({ auth, log: quietOctokitLog });
}
