import { useCallback, useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';

export type FeedbackCategory = 'bug' | 'idea' | 'contact';

interface FeedbackSubmitOptions {
  onSuccess: () => void;
}

async function fileToUint8Array(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function useFeedbackSubmit({ onSuccess }: FeedbackSubmitOptions) {
  const [feedbackDetails, setFeedbackDetails] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { toast } = useToast();

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const reset = useCallback(() => {
    setFeedbackDetails('');
    setCategory('idea');
    setSubmitting(false);
    setErrorMessage(null);
  }, []);

  const handleSubmit = useCallback(
    async (attachments: File[]) => {
      const trimmedFeedback = feedbackDetails.trim();
      if (trimmedFeedback.length < 4) {
        setErrorMessage('Please enter some feedback before sending.');
        return;
      }

      setSubmitting(true);
      setErrorMessage(null);

      try {
        const attachmentPayload = await Promise.all(
          attachments.map(async (file) => ({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            data: await fileToUint8Array(file),
          }))
        );

        const result = await rpc.feedback.submit({
          message: trimmedFeedback,
          category,
          attachments: attachmentPayload,
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to send feedback');
        }

        onSuccess();
        toast({ title: 'Feedback sent', description: 'Thanks for your feedback!' });
      } catch (error) {
        log.error('Failed to submit feedback:', error);
        const message = error instanceof Error ? error.message : 'Unable to send feedback.';
        setErrorMessage(message);
        toast({
          title: 'Failed to send feedback',
          description: 'Please try again.',
          variant: 'destructive',
        });
      } finally {
        setSubmitting(false);
      }
    },
    [category, feedbackDetails, onSuccess, toast]
  );

  return {
    feedbackDetails,
    setFeedbackDetails,
    category,
    setCategory,
    submitting,
    errorMessage,
    clearError,
    reset,
    handleSubmit,
    canSubmit: feedbackDetails.trim().length >= 4 && !submitting,
  };
}
