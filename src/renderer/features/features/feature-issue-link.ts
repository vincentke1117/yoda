import type { FeatureSummary } from '@shared/features';
import type { Issue } from '@shared/tasks';

export function findFeatureForIssue(
  features: readonly FeatureSummary[],
  issue: Pick<Issue, 'url'>
): FeatureSummary | undefined {
  return features.find((feature) => feature.sourceIssueUrls.includes(issue.url));
}
