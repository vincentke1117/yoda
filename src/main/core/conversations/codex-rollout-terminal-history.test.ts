import { describe, expect, it } from 'vitest';
import { formatCodexRolloutTerminalHistory } from './codex-rollout-terminal-history';

describe('formatCodexRolloutTerminalHistory', () => {
  it('formats Codex event messages and command output for terminal replay', () => {
    const raw = [
      {
        timestamp: '2026-06-04T01:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_started',
        },
      },
      {
        timestamp: '2026-06-04T01:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Please inspect the project',
        },
      },
      {
        timestamp: '2026-06-04T01:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'I will read the relevant files first.',
        },
      },
      {
        timestamp: '2026-06-04T01:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'exec_command_end',
          command: ['/bin/zsh', '-lc', 'pnpm test'],
          aggregated_output: 'Tests passed',
          status: 'completed',
          exit_code: 0,
        },
      },
      {
        timestamp: '2026-06-04T01:00:04.000Z',
        type: 'event_msg',
        payload: {
          type: 'task_complete',
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    const history = formatCodexRolloutTerminalHistory(raw, {
      threadId: 'thread-1',
      title: 'Test thread',
      rolloutPath: '/tmp/rollout.jsonl',
    });

    expect(history).toContain('Codex history loaded from rollout transcript');
    expect(history).toContain('[Status 2026-06-04T01:00:00.000Z]\nTask started');
    expect(history).toContain('[User 2026-06-04T01:00:01.000Z]\nPlease inspect the project');
    expect(history).toContain(
      '[Codex 2026-06-04T01:00:02.000Z]\nI will read the relevant files first.'
    );
    expect(history).toContain("$ /bin/zsh -lc 'pnpm test'");
    expect(history).toContain('Tests passed');
    expect(history).toContain('[completed, exit 0]');
    expect(history).toContain('Task complete');
  });

  it('falls back to response items when event messages are unavailable', () => {
    const raw = [
      {
        timestamp: '2026-06-04T01:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Build the feature' }],
        },
      },
      {
        timestamp: '2026-06-04T01:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Implemented.' }],
        },
      },
      {
        timestamp: '2026-06-04T01:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'Developer instructions' }],
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');

    const history = formatCodexRolloutTerminalHistory(raw, {
      threadId: 'thread-1',
      title: 'Test thread',
      rolloutPath: '/tmp/rollout.jsonl',
    });

    expect(history).toContain('[User 2026-06-04T01:00:01.000Z]\nBuild the feature');
    expect(history).toContain('[Codex 2026-06-04T01:00:02.000Z]\nImplemented.');
    expect(history).not.toContain('Developer instructions');
  });
});
