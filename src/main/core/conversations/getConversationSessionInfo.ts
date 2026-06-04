import { and, eq } from 'drizzle-orm';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ConversationSessionInfo } from '@shared/conversations';
import {
  readCodexThreadArchiveStatus,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { db } from '@main/db/client';
import { conversations, projects } from '@main/db/schema';
import { resolveAgentResumeSessionId } from './codex-session-id';
import { buildAgentCommand, buildAgentSubcommand } from './impl/agent-command';
import { mapConversationRowToConversation } from './utils';

export async function getConversationSessionInfo(
  projectId: string,
  taskId: string,
  conversationId: string,
  cwd?: string
): Promise<ConversationSessionInfo> {
  const [row] = await db
    .select({ conversation: conversations, projectPath: projects.path })
    .from(conversations)
    .innerJoin(projects, eq(conversations.projectId, projects.id))
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);

  if (!row) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const conversation = mapConversationRowToConversation(row.conversation, true);
  const workingDirectory = cwd?.trim() || row.projectPath;
  const sessionId = resolveAgentResumeSessionId(conversation, workingDirectory);

  return {
    sessionId,
    resumeCommand: await buildResumeCommand({
      providerId: conversation.providerId,
      sessionId,
      cwd: workingDirectory,
      includeUnarchive:
        conversation.providerId === 'codex' &&
        readCodexThreadArchiveStatus(resolveCodexStatePath(), sessionId) === true,
    }),
  };
}

async function buildResumeCommand({
  providerId,
  sessionId,
  cwd,
  includeUnarchive,
}: {
  providerId: AgentProviderId;
  sessionId: string;
  cwd?: string;
  includeUnarchive?: boolean;
}): Promise<string | undefined> {
  const providerConfig = await providerOverrideSettings.getItem(providerId);
  if (!providerConfig?.cli) return undefined;
  if (!providerConfig.resumeFlag && !providerConfig.sessionIdFlag) return undefined;

  const { command, args } = buildAgentCommand({
    providerId,
    providerConfig,
    sessionId,
    isResuming: true,
    workingDirectory: cwd,
  });
  const commands: string[] = [];
  if (includeUnarchive) {
    const unarchive = buildAgentSubcommand({
      providerId,
      providerConfig,
      subcommand: 'unarchive',
      subcommandArgs: [sessionId],
    });
    commands.push(shellCommand(unarchive.command, unarchive.args));
  }
  commands.push(shellCommand(command, args));
  const cmd = commands.join(' && ');
  return cwd ? `cd ${shellQuote(cwd)} && ${cmd}` : cmd;
}

function shellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(' ');
}

function shellQuote(value: string): string {
  if (value.length > 0 && /^[A-Za-z0-9_\-./:=@%+,]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
