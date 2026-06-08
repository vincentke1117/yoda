import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildGitHubIssueUrl, feedbackCategorySlug, type FeedbackCategory } from '@shared/feedback';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

interface GitHubIssueFeedbackOptions {
  onOpenIssue: () => void;
}

function buildIssueTitle(category: FeedbackCategory, details: string): string {
  const firstLine = details.trim().split(/\r?\n/, 1)[0]?.trim() || 'Feedback';
  const normalized = Array.from(firstLine).slice(0, 80).join('');
  return `[${category}] ${normalized}`;
}

function buildIssueBody(args: {
  category: FeedbackCategory;
  details: string;
  appVersion: string | null;
  platform: string | null;
}): string {
  return [
    '### Category',
    args.category,
    '',
    '### Description',
    args.details.trim(),
    '',
    '### Environment',
    `- Yoda version: ${args.appVersion ?? 'Unknown'}`,
    `- Platform: ${args.platform ?? 'Unknown'}`,
    '',
    '### Screenshots or logs',
    'Attach screenshots, recordings, or logs here if they help explain the issue.',
  ].join('\n');
}

export function useGitHubIssueFeedback({ onOpenIssue }: GitHubIssueFeedbackOptions) {
  const [feedbackDetails, setFeedbackDetails] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('Bug');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([rpc.app.getAppVersion(), rpc.app.getPlatform()])
      .then(([nextAppVersion, nextPlatform]) => {
        if (cancelled) return;
        setAppVersion(nextAppVersion);
        setPlatform(nextPlatform);
      })
      .catch(() => {
        if (cancelled) return;
        setAppVersion(null);
        setPlatform(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const issueTitle = useMemo(
    () => buildIssueTitle(category, feedbackDetails),
    [category, feedbackDetails]
  );
  const issueBody = useMemo(
    () => buildIssueBody({ category, details: feedbackDetails, appVersion, platform }),
    [appVersion, category, feedbackDetails, platform]
  );
  const issueUrl = useMemo(
    () => buildGitHubIssueUrl({ title: issueTitle, body: issueBody }),
    [issueBody, issueTitle]
  );

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const copyIssueDetails = useCallback(async () => {
    const result = await rpc.app.clipboardWriteText(`# ${issueTitle}\n\n${issueBody}`);
    if (!result.success) {
      const message = result.error || 'Unable to copy issue details.';
      setErrorMessage(message);
      toast({
        title: 'Failed to copy issue details',
        description: message,
        variant: 'destructive',
      });
      return;
    }

    toast({ title: 'Issue details copied' });
  }, [issueBody, issueTitle, toast]);

  const openIssue = useCallback(async () => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await rpc.app.openExternal(issueUrl);
      if (!result.success) {
        throw new Error(result.error || 'Unable to open GitHub issue.');
      }
      onOpenIssue();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open GitHub issue.';
      setErrorMessage(message);
      toast({
        title: 'Failed to open GitHub issue',
        description: message,
        variant: 'destructive',
        debugInfo: {
          error,
          category,
          categorySlug: feedbackCategorySlug(category),
          issueUrl,
        },
      });
    } finally {
      setSubmitting(false);
    }
  }, [category, issueUrl, onOpenIssue, toast]);

  return {
    feedbackDetails,
    setFeedbackDetails,
    category,
    setCategory,
    submitting,
    errorMessage,
    clearError,
    copyIssueDetails,
    openIssue,
    issueUrl,
    issueBody,
  };
}
