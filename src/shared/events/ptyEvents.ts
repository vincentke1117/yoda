import { defineEvent } from '@shared/ipc/events';

export const PTY_CONSUMER_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * A monotonically ordered batch of PTY output.
 *
 * generation changes whenever a session id is registered with a new backend
 * PTY. sequence is local to that generation. Together they let renderers
 * bridge the subscribe snapshot/live-event boundary without losing or
 * duplicating bytes, and discard late events from a previous process.
 */
export type PtyDataEvent = {
  generation: number;
  sequence: number;
  byteLength: number;
  data: string;
};

// 'pty:data' matches the channel name consumed by TerminalSessionManager.
export const ptyDataChannel = defineEvent<PtyDataEvent>('pty:data');

export type PtyExitEvent = {
  /** Backend generation that exited; changes whenever this session id respawns. */
  generation: number;
  exitCode?: number;
  signal?: number | string;
};

export const ptyExitChannel = defineEvent<PtyExitEvent>('pty:exit');

export const ptyInputChannel = defineEvent<string>('pty:input');

/**
 * Renderer → main keystroke delivery.
 *
 * Input is a one-way send, not an RPC. A `invoke` round-trip put a promise
 * resolution on the critical path of every keypress; the reply carried nothing
 * the renderer acts on beyond a warning log, which main can emit itself.
 */
export type PtyInputSendEvent = {
  sessionId: string;
  data: string;
};

export const ptyInputSendChannel = defineEvent<PtyInputSendEvent>('pty:input-send');

/**
 * Renderer → main cumulative parse acknowledgement.
 *
 * Fire-and-forget for the same reason as input: the ack advances a watermark in
 * main and the renderer never reads the reply. Losing one ack costs nothing —
 * the next batch's ack is cumulative, and a stalled consumer is already covered
 * by `PTY_CONSUMER_ACK_STALL_TIMEOUT_MS`.
 */
export type PtyAcknowledgeEvent = {
  sessionId: string;
  consumerId: string;
  generation: number;
  sequence: number;
};

export const ptyAcknowledgeChannel = defineEvent<PtyAcknowledgeEvent>('pty:acknowledge');
