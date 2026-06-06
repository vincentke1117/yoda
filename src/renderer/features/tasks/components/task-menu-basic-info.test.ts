import { describe, expect, it } from 'vitest';
import { buildTaskBasicInfo, type TaskBasicInfoLabels } from './task-menu-basic-info';

const labels: TaskBasicInfoLabels = {
  provider: 'Provider',
  project: 'Project',
  projectPath: 'Project path',
  task: 'Task',
  taskId: 'Task ID',
  branch: 'Branch',
  sessionId: 'Session ID',
  contentSource: 'Content source',
  readInstruction: 'Read instruction',
  readInstructionValue:
    'Read the JSONL file above; parse one JSON object per line and extract user/assistant messages in chronological order.',
};

describe('buildTaskBasicInfo', () => {
  it('builds task-scoped basic info', () => {
    expect(
      buildTaskBasicInfo(
        {
          projectName: 'Yoda',
          projectPath: '/repo',
          taskId: 'task-1',
          taskName: 'Fix task menu',
          branchName: 'main',
        },
        labels
      )
    ).toBe(
      'Task: Fix task menu\nProject: Yoda\nProject path: /repo\nBranch: main\nTask ID: task-1'
    );
  });

  it('falls back to the project id when the project name is blank', () => {
    expect(
      buildTaskBasicInfo(
        {
          projectId: 'project-1',
          projectName: ' ',
          taskId: 'task-1',
        },
        labels
      )
    ).toBe('Project: project-1\nTask ID: task-1');
  });

  it('includes external AI content source instructions when available', () => {
    expect(
      buildTaskBasicInfo(
        {
          taskName: 'Fix task menu',
          taskId: 'task-1',
          providerName: 'Codex',
          sessionId: 'session-1',
          contentSourcePath: '/Users/me/.codex/sessions/rollout-session-1.jsonl',
        },
        labels
      )
    ).toBe(
      [
        'Task: Fix task menu',
        'Task ID: task-1',
        'Provider: Codex',
        'Session ID: session-1',
        'Content source: /Users/me/.codex/sessions/rollout-session-1.jsonl',
        'Read instruction: Read the JSONL file above; parse one JSON object per line and extract user/assistant messages in chronological order.',
      ].join('\n')
    );
  });

  it('keeps long user-provided values intact instead of hard-truncating', () => {
    const longTaskName = 'A'.repeat(120);
    const value = buildTaskBasicInfo(
      {
        projectName: 'Yoda',
        taskId: 'task-1',
        taskName: longTaskName,
        branchName: 'feature/copy-task-basic-info',
      },
      labels
    );

    expect(value).toContain(longTaskName);
    expect(value?.endsWith('...')).toBe(false);
  });

  it('returns undefined when no task info is available', () => {
    expect(buildTaskBasicInfo({}, labels)).toBeUndefined();
  });
});
