import { clipboard, nativeImage, type NativeImage } from 'electron';
import {
  buildPromptInjectionPayload,
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitInput,
} from '@shared/agent-command-prefix';
import type { RuntimeId } from '@shared/runtime-registry';
import type { Pty } from '@main/core/pty/pty';
import { log } from '@main/lib/logger';

const CTRL_V = '\x16';
/** TUI is considered booted once output has gone quiet for this long. */
const TUI_READY_QUIET_MS = 700;
const TUI_READY_TIMEOUT_MS = 10_000;
/** Time the TUI gets to read the clipboard before it is overwritten/restored. */
const IMAGE_PASTE_DELAY_MS = 500;
const PROMPT_SUBMIT_DELAY_MS = 150;

/**
 * Fallback transport for runtimes without clipboard paste: serialize image
 * paths as @-mentions appended to the prompt. Every CLI resolves file paths
 * from the message text, so this works universally (just without the native
 * image rendering in the TUI).
 */
export function appendImageMentions(
  prompt: string | undefined,
  imagePaths: string[]
): string | undefined {
  if (imagePaths.length === 0) return prompt;
  const mentions = imagePaths.map((imagePath) => `@${imagePath}`).join('\n');
  const trimmed = prompt?.trim();
  return trimmed ? `${trimmed}\n\n${mentions}` : mentions;
}

/**
 * Deliver image attachments the way a user would: wait for the TUI to boot,
 * write each image to the OS clipboard and send Ctrl+V (the CLI reads the
 * clipboard itself and renders its native image placeholder), then inject the
 * prompt text and submit. Images that cannot be decoded (e.g. SVG) fall back
 * to @path mentions appended to the injected text. The user's clipboard is
 * restored afterwards.
 */
export async function injectClipboardImagesAndPrompt({
  pty,
  runtimeId,
  imagePaths,
  prompt,
}: {
  pty: Pty;
  runtimeId: RuntimeId;
  imagePaths: string[];
  prompt?: string;
}): Promise<void> {
  await waitForTuiReady(pty);

  const failedPaths: string[] = [];
  const saved = captureClipboard();
  try {
    for (const imagePath of imagePaths) {
      const image = nativeImage.createFromPath(imagePath);
      if (image.isEmpty()) {
        failedPaths.push(imagePath);
        log.warn('injectClipboardImagesAndPrompt: image could not be decoded, falling back', {
          imagePath,
        });
        continue;
      }
      clipboard.writeImage(image);
      pty.write(CTRL_V);
      await sleep(IMAGE_PASTE_DELAY_MS);
    }
  } finally {
    restoreClipboard(saved);
  }

  const text = appendImageMentions(prompt, failedPaths);
  if (text) pty.write(buildPromptInjectionPayload(text));
  await sleep(Math.max(getAgentCommandSubmitDelayMs(runtimeId), PROMPT_SUBMIT_DELAY_MS));
  pty.write(getAgentCommandSubmitInput(runtimeId));
}

/** Resolves once PTY output has been quiet for TUI_READY_QUIET_MS (or on timeout). */
function waitForTuiReady(pty: Pty): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(timeout);
      resolve();
    };
    // Pty.onData has no unsubscribe; the handler turns into a no-op once done.
    pty.onData(() => {
      if (done) return;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, TUI_READY_QUIET_MS);
      quietTimer.unref?.();
    });
    const timeout = setTimeout(finish, TUI_READY_TIMEOUT_MS);
    timeout.unref?.();
  });
}

type SavedClipboard = { image: NativeImage; text: string };

function captureClipboard(): SavedClipboard {
  return { image: clipboard.readImage(), text: clipboard.readText() };
}

function restoreClipboard(saved: SavedClipboard): void {
  try {
    if (!saved.image.isEmpty()) clipboard.writeImage(saved.image);
    else if (saved.text) clipboard.writeText(saved.text);
    else clipboard.clear();
  } catch (error) {
    log.warn('injectClipboardImagesAndPrompt: failed to restore clipboard', {
      error: String(error),
    });
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
