import { app } from 'electron';
import { ACCOUNT_CONFIG } from '@main/core/account/config';
import { yodaAccountService } from '@main/core/account/services/yoda-account-service';
import { log } from '@main/lib/logger';

export interface FeedbackAttachmentInput {
  filename: string;
  contentType: string;
  data: Uint8Array;
}

export interface SubmitFeedbackInput {
  message: string;
  category?: 'bug' | 'idea' | 'contact';
  attachments?: FeedbackAttachmentInput[];
}

export interface SubmitFeedbackResult {
  success: boolean;
  error?: string;
  feedbackId?: string;
  emailSent?: boolean;
}

class FeedbackService {
  async submit(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
    const session = await yodaAccountService.getSession();
    if (!session.isSignedIn) {
      return { success: false, error: 'Not signed in.' };
    }
    const token = yodaAccountService.getSessionToken();
    if (!token) {
      return { success: false, error: 'No session token available.' };
    }

    const trimmedMessage = input.message?.trim() ?? '';
    if (trimmedMessage.length < 4) {
      return { success: false, error: 'Feedback message is too short.' };
    }

    const form = new FormData();
    form.append('product', 'yoda');
    form.append('source', 'yoda-desktop');
    form.append('message', trimmedMessage);
    form.append('category', input.category ?? 'idea');
    form.append('appVersion', app.getVersion());

    (input.attachments ?? []).forEach((attachment, index) => {
      const copied = new ArrayBuffer(attachment.data.byteLength);
      new Uint8Array(copied).set(attachment.data);
      const blob = new Blob([copied], { type: attachment.contentType });
      form.append(`file${index}`, blob, attachment.filename);
    });

    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    try {
      const response = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        feedbackId?: string;
        emailSent?: boolean;
        error?: string;
      } | null;

      if (!response.ok) {
        return {
          success: false,
          error: json?.error || `Feedback server returned ${response.status}`,
        };
      }
      return {
        success: true,
        feedbackId: json?.feedbackId,
        emailSent: json?.emailSent,
      };
    } catch (error) {
      log.error('Failed to submit feedback:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }
}

export const feedbackService = new FeedbackService();
