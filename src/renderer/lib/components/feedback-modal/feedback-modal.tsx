import { Copy, ExternalLink, Github } from 'lucide-react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MIN_FEEDBACK_DETAILS_LENGTH,
  YODA_GITHUB_ISSUES_URL,
  type FeedbackCategory,
} from '@shared/feedback';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Textarea } from '@renderer/lib/ui/textarea';
import { useGitHubIssueFeedback } from './use-github-issue-feedback';

type FeedbackModalArgs = {
  blurb?: string;
};

type Props = BaseModalProps<void> & FeedbackModalArgs;

const FEEDBACK_CATEGORY_OPTIONS = [
  { value: 'Bug', labelKey: 'feedback.category.bug' },
  { value: 'Idea', labelKey: 'feedback.category.idea' },
  { value: 'Contact', labelKey: 'feedback.category.contact' },
] as const satisfies readonly { value: FeedbackCategory; labelKey: string }[];

export function FeedbackModal({ onSuccess, blurb }: Props) {
  const { t } = useTranslation();
  const {
    feedbackDetails,
    setFeedbackDetails,
    category,
    setCategory,
    submitting,
    errorMessage,
    clearError,
    copyIssueDetails,
    openIssue,
  } = useGitHubIssueFeedback({
    onOpenIssue: onSuccess,
  });

  const categoryLabel = t(
    FEEDBACK_CATEGORY_OPTIONS.find((option) => option.value === category)?.labelKey ??
      'feedback.category.bug'
  );
  const feedbackDetailsLength = feedbackDetails.trim().length;
  const remainingDetailsLength = Math.max(0, MIN_FEEDBACK_DETAILS_LENGTH - feedbackDetailsLength);
  const detailsHint =
    remainingDetailsLength > 0
      ? feedbackDetailsLength > 0
        ? t('feedback.detailsRemaining', { count: remainingDetailsLength })
        : t('feedback.detailsMinimum', { count: MIN_FEEDBACK_DETAILS_LENGTH })
      : t('feedback.githubReady');
  const canCreateIssue = feedbackDetailsLength >= MIN_FEEDBACK_DETAILS_LENGTH && !submitting;

  const handleFormSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canCreateIssue) return;
      await openIssue();
    },
    [canCreateIssue, openIssue]
  );

  const handleOpenIssues = useCallback(() => {
    void rpc.app.openExternal(YODA_GITHUB_ISSUES_URL);
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <div className="flex flex-col gap-0.5">
          <DialogTitle>{t('feedback.title')}</DialogTitle>
          <DialogDescription className="text-xs">
            {blurb || t('feedback.githubDescription')}
          </DialogDescription>
        </div>
      </DialogHeader>
      <DialogContentArea>
        <form id="feedback-form" className="space-y-4 pt-0.5" onSubmit={handleFormSubmit}>
          <div className="rounded-md border border-border bg-background-quaternary-1 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <Github className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t('feedback.githubIssueTitle')}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('feedback.githubIssueDescription')}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                onClick={handleOpenIssues}
              >
                <ExternalLink className="size-3.5" />
                <span>{t('feedback.viewIssues')}</span>
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="feedback-category"
              className="text-xs font-medium text-muted-foreground"
            >
              {t('feedback.category.label')}
            </label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as FeedbackCategory)}
            >
              <SelectTrigger id="feedback-category" className="w-40">
                <SelectValue>{categoryLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FEEDBACK_CATEGORY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="feedback-details" className="sr-only">
              {t('feedback.detailsLabel')}
            </label>
            <Textarea
              id="feedback-details"
              aria-describedby="feedback-details-hint"
              autoFocus
              rows={6}
              placeholder={t('feedback.detailsPlaceholder')}
              className="resize-none"
              value={feedbackDetails}
              onChange={(event) => {
                setFeedbackDetails(event.target.value);
                if (errorMessage) clearError();
              }}
            />
            <p id="feedback-details-hint" className="text-xs text-muted-foreground">
              {detailsHint}
            </p>
          </div>

          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </form>
      </DialogContentArea>
      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={copyIssueDetails}
          className="gap-2"
          disabled={!canCreateIssue}
        >
          <Copy className="size-4" aria-hidden="true" />
          <span>{t('feedback.copyIssueDetails')}</span>
        </Button>
        <Button
          type="submit"
          form="feedback-form"
          className="gap-2 px-4"
          disabled={!canCreateIssue}
          aria-busy={submitting}
        >
          {submitting ? (
            <>
              <Spinner size="sm" />
              <span>{t('feedback.openingGithub')}</span>
            </>
          ) : (
            <>
              <ExternalLink className="size-4" aria-hidden="true" />
              <span>{t('feedback.openGithubIssue')}</span>
            </>
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}
