export const FEEDBACK_CATEGORIES = ['Idea', 'Bug', 'Contact'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const MIN_FEEDBACK_DETAILS_LENGTH = 4;
export const YODA_GITHUB_REPOSITORY_URL = 'https://github.com/lovstudio/yoda';
export const YODA_GITHUB_ISSUES_URL = `${YODA_GITHUB_REPOSITORY_URL}/issues`;
export const YODA_GITHUB_NEW_ISSUE_URL = `${YODA_GITHUB_ISSUES_URL}/new`;

export function feedbackCategorySlug(category: FeedbackCategory): string {
  switch (category) {
    case 'Idea':
      return 'idea';
    case 'Bug':
      return 'bug';
    case 'Contact':
      return 'contact';
  }
}

export function buildGitHubIssueUrl(args: { title: string; body: string }): string {
  const url = new URL(YODA_GITHUB_NEW_ISSUE_URL);
  url.searchParams.set('title', args.title);
  url.searchParams.set('body', args.body);
  return url.toString();
}
