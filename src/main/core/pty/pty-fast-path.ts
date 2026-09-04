import { BrowserWindow, webContents } from 'electron';
import {
  ptyAcknowledgeChannel,
  ptyDataChannel,
  ptyExitChannel,
  ptyInputSendChannel,
} from '@shared/events/ptyEvents';
import { events, setEventWindowResolver } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { deliverPtyInput } from './controller';
import { ptySessionRegistry } from './pty-session-registry';

/**
 * The renderer↔main terminal hot path, kept off the RPC transport.
 *
 * Keystrokes and parse acknowledgements are one-way sends rather than `invoke`
 * calls: both used to put a promise round-trip on the critical path of every
 * keypress and every output batch, and neither reply carried anything the
 * renderer acted on. Output is addressed at the windows that subscribed instead
 * of broadcast to all of them.
 *
 * Registered once at startup; the listeners live for the life of the process.
 */
export function registerPtyFastPathListeners(): void {
  events.on(ptyInputSendChannel, (event) => {
    if (!event || typeof event.sessionId !== 'string' || typeof event.data !== 'string') return;
    void deliverPtyInput(event.sessionId, event.data)
      .then((status) => {
        // The renderer no longer awaits a reply, so a rejected write has to be
        // reported here or it is lost.
        if (status === 'full' || status === 'unavailable') {
          log.warn('[pty-input] input not delivered', { sessionId: event.sessionId, status });
        }
      })
      .catch((error) => {
        log.warn('[pty-input] input delivery failed', {
          sessionId: event.sessionId,
          error: String(error),
        });
      });
  });

  events.on(ptyAcknowledgeChannel, (event) => {
    if (!event || typeof event.sessionId !== 'string' || typeof event.consumerId !== 'string') {
      return;
    }
    ptySessionRegistry.acknowledge(
      event.sessionId,
      event.consumerId,
      event.generation,
      event.sequence
    );
  });

  const resolveSessionWindows = (sessionId: string | undefined): BrowserWindow[] | null => {
    if (!sessionId) return null;
    const ownerIds = ptySessionRegistry.consumerOwnerWebContentsIds(sessionId);
    if (!ownerIds) return null;
    const windows: BrowserWindow[] = [];
    for (const id of ownerIds) {
      const contents = webContents.fromId(id);
      if (!contents || contents.isDestroyed()) continue;
      const win = BrowserWindow.fromWebContents(contents);
      if (win) windows.push(win);
    }
    return windows;
  };

  setEventWindowResolver(ptyDataChannel.name, resolveSessionWindows);
  setEventWindowResolver(ptyExitChannel.name, resolveSessionWindows);
}
