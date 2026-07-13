import { describe, expect, it } from 'vitest';
import type { FeatureSummary } from '@shared/features';
import { findFeatureForIssue } from './feature-issue-link';

const summary = (id: string, sourceIssueUrls: string[]): FeatureSummary => ({
  id,
  projectId: 'project-1',
  title: id,
  stage: 'problem',
  status: 'active',
  sourceIssueUrls,
  taskIds: [],
  taskCount: 0,
  artifactCount: 0,
  gate: { stage: 'problem', nextStage: 'design', canAdvance: true, blockers: [] },
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
});

describe('findFeatureForIssue', () => {
  it('returns the Feature that owns the source Issue', () => {
    expect(
      findFeatureForIssue(
        [summary('other', ['https://github.com/acme/repo/issues/1']), summary('target', ['u2'])],
        { url: 'u2' }
      )?.id
    ).toBe('target');
  });

  it('returns undefined when an Issue has not entered the Feature workflow', () => {
    expect(findFeatureForIssue([summary('other', ['u1'])], { url: 'u2' })).toBeUndefined();
  });
});
