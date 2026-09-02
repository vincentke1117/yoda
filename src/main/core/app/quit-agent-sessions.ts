import { PRODUCT_NAME } from '@shared/app-identity';
import { isAgentSessionRunningStatus } from '@shared/events/agentEvents';
import { getRuntime } from '@shared/runtime-registry';
import type {
  ActiveBackendProcessSummary,
  BackendProcessInfo,
} from '@main/core/backend-processes/backend-process-registry';
import type { ActiveConversationSession } from '@main/core/conversations/types';
import type { ActiveAgentSessionSummary } from '@main/core/tasks/task-manager';
import type {
  ActiveWorkspaceTerminalSession,
  ActiveWorkspaceTerminalSessionSummary,
} from '@main/core/terminals/workspace-terminal-service';
import type { TeardownMode } from '@main/core/workspaces/workspace-registry';

export type QuitAgentSessionsDecision =
  | { action: 'quit'; mode: TeardownMode }
  | { action: 'cancel' };

type QuitDialogOptions = {
  type: 'question';
  buttons: string[];
  defaultId: number;
  cancelId: number;
  title: string;
  message: string;
  detail: string;
  noLink: boolean;
};

type ShowQuitDialog = (options: QuitDialogOptions) => number;

type QuitSessionInfo =
  | ActiveAgentSessionSummary['nonKeepableSessions'][number]
  | ActiveWorkspaceTerminalSession
  | BackendProcessInfo;

export type ActiveQuitSessionSummary = {
  running: number;
  keepable: number;
  agentSessions: number;
  terminalSessions: number;
  backendProcesses: number;
  nonKeepableSessions: QuitSessionInfo[];
};

type RestartAgentSession = ActiveConversationSession & {
  status: Parameters<typeof isAgentSessionRunningStatus>[0];
};

/**
 * Quit keeps its existing running-only contract. Restart must also protect
 * idle/completed tmux sessions: terminating them would destroy work that can
 * otherwise survive the application relaunch, regardless of whether Yoda's
 * transport is currently attached.
 */
export function resolveAgentSessionSummaryForShutdown(
  restartRequested: boolean,
  runningSummary: ActiveAgentSessionSummary,
  agentSessions: readonly RestartAgentSession[]
): ActiveAgentSessionSummary {
  if (!restartRequested) return runningSummary;

  const protectedSessions = agentSessions.filter(
    (session) => session.detachable || isAgentSessionRunningStatus(session.status)
  );
  return {
    running: protectedSessions.length,
    keepable: protectedSessions.filter((session) => session.detachable).length,
    nonKeepableSessions: protectedSessions.filter((session) => !session.detachable),
  };
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function messageFor(summary: ActiveQuitSessionSummary): string {
  const parts: string[] = [];
  if (summary.agentSessions > 0) {
    parts.push(
      `${summary.agentSessions} ${pluralize(summary.agentSessions, 'agent session', 'agent sessions')}`
    );
  }
  if (summary.terminalSessions > 0) {
    parts.push(
      `${summary.terminalSessions} ${pluralize(summary.terminalSessions, 'terminal session', 'terminal sessions')}`
    );
  }
  if (summary.backendProcesses > 0) {
    parts.push(
      `${summary.backendProcesses} ${pluralize(summary.backendProcesses, 'backend process', 'backend processes')}`
    );
  }

  const verb = summary.running === 1 ? 'is' : 'are';
  if (parts.length === 1) {
    if (summary.agentSessions === 1) return 'An agent session is still running.';
    if (summary.terminalSessions === 1) return 'A terminal session is still running.';
    if (summary.backendProcesses === 1) return 'A backend process is still running.';
    return `${parts[0]} ${verb} still running.`;
  }
  return `${parts.slice(0, -1).join(', ')}${parts.length > 2 ? ',' : ''} and ${parts[parts.length - 1]} ${verb} still running.`;
}

type SessionDetail = ActiveQuitSessionSummary['nonKeepableSessions'][number];

const MAX_VISIBLE_SESSION_DETAILS = 8;
const MAX_SESSION_LABEL_LENGTH = 96;

function truncateLabel(value: string): string {
  if (value.length <= MAX_SESSION_LABEL_LENGTH) return value;
  return `${value.slice(0, MAX_SESSION_LABEL_LENGTH - 3)}...`;
}

function sessionLabel(session: SessionDetail): string {
  if ('kind' in session) {
    const kindLabel = session.kind === 'metro' ? 'Metro' : 'App preview';
    const label = session.label.trim() || session.id;
    return truncateLabel(`${label} (${kindLabel})`);
  }
  if ('terminalId' in session) {
    return truncateLabel(`${session.name.trim() || session.terminalId} (Terminal)`);
  }
  const taskTitle = session.taskTitle?.trim() || session.taskId;
  const title = session.title.trim() || session.conversationId;
  const runtimeName = getRuntime(session.runtimeId)?.name ?? session.runtimeId;
  return truncateLabel(`${taskTitle} - ${title} (${runtimeName})`);
}

function formatSessionList(sessions: SessionDetail[]): string {
  if (sessions.length === 0) return '';

  const visible = sessions.slice(0, MAX_VISIBLE_SESSION_DETAILS).map((session) => {
    return `- ${sessionLabel(session)}`;
  });
  const hiddenCount = sessions.length - visible.length;
  if (hiddenCount > 0) {
    visible.push(`- and ${hiddenCount} more`);
  }
  return visible.join('\n');
}

function directOnlyDetail(summary: ActiveQuitSessionSummary): string {
  const count = summary.running;
  const sessionText = count === 1 ? "This session isn't" : "These sessions aren't";
  const pronoun = count === 1 ? 'it' : 'they';
  const stopObject = count === 1 ? 'it' : 'them';
  const list = formatSessionList(summary.nonKeepableSessions);

  const intro = `${sessionText} detachable, so ${pronoun} can't keep running in the background after ${PRODUCT_NAME} quits.`;
  const action = `Stop ${stopObject} to quit, or cancel to keep working.`;

  return list ? `${intro}\n\n${list}\n\n${action}` : `${intro} ${action}`;
}

function mixedDetail(summary: ActiveQuitSessionSummary, keepable: number, direct: number): string {
  const list = formatSessionList(summary.nonKeepableSessions);
  const intro = `${keepable} ${pluralize(keepable, 'session can', 'sessions can')} be kept running in the background. ${direct} ${pluralize(direct, 'session', 'sessions')} will stop if ${PRODUCT_NAME} quits.`;

  return list ? `${intro}\n\n${list}` : intro;
}

export function resolveQuitAgentSessionsDecision(
  summary: ActiveQuitSessionSummary,
  showDialog: ShowQuitDialog
): QuitAgentSessionsDecision {
  if (summary.running <= 0) return { action: 'quit', mode: 'terminate' };

  const keepable = Math.max(0, Math.min(summary.keepable, summary.running));
  const direct = summary.running - keepable;
  const title = `Quit ${PRODUCT_NAME}?`;
  const message = messageFor(summary);

  if (keepable === summary.running) {
    const response = showDialog({
      type: 'question',
      buttons: ['Keep Running', 'Stop Sessions', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title,
      message,
      detail: `Keep them running in the background after ${PRODUCT_NAME} quits, or stop them before exiting.`,
      noLink: true,
    });
    if (response === 0) return { action: 'quit', mode: 'detach' };
    if (response === 1) return { action: 'quit', mode: 'terminate' };
    return { action: 'cancel' };
  }

  if (keepable > 0) {
    const response = showDialog({
      type: 'question',
      buttons: ['Keep Running', 'Stop Sessions', 'Cancel'],
      defaultId: 2,
      cancelId: 2,
      title,
      message,
      detail: mixedDetail(summary, keepable, direct),
      noLink: true,
    });
    if (response === 0) return { action: 'quit', mode: 'detach' };
    if (response === 1) return { action: 'quit', mode: 'terminate' };
    return { action: 'cancel' };
  }

  const response = showDialog({
    type: 'question',
    buttons: ['Stop Sessions', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title,
    message,
    detail: directOnlyDetail(summary),
    noLink: true,
  });
  if (response === 0) return { action: 'quit', mode: 'terminate' };
  return { action: 'cancel' };
}

export function combineActiveSessionSummaries(
  agents: ActiveAgentSessionSummary,
  terminals: ActiveWorkspaceTerminalSessionSummary,
  backend: ActiveBackendProcessSummary
): ActiveQuitSessionSummary {
  return {
    running: agents.running + terminals.running + backend.running,
    keepable: agents.keepable + terminals.keepable + backend.keepable,
    agentSessions: agents.running,
    terminalSessions: terminals.running,
    backendProcesses: backend.running,
    nonKeepableSessions: [
      ...agents.nonKeepableSessions,
      ...terminals.nonKeepableSessions,
      ...backend.nonKeepableSessions,
    ],
  };
}
