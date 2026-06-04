import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  readCodexThreadArchiveStatus,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';
import { log } from '@main/lib/logger';
import { buildAgentSubcommand } from './impl/agent-command';

const CODEX_UNARCHIVE_TIMEOUT_MS = 10_000;
const CODEX_UNARCHIVE_MAX_BUFFER = 32 * 1024;

export async function ensureCodexThreadUnarchived({
  providerId,
  providerConfig,
  threadId,
  ctx,
  statePath = resolveCodexStatePath(),
}: {
  providerId: AgentProviderId;
  providerConfig: ProviderCustomConfig | undefined;
  threadId: string;
  ctx: IExecutionContext;
  statePath?: string;
}): Promise<void> {
  if (providerId !== 'codex') return;
  if (readCodexThreadArchiveStatus(statePath, threadId) !== true) return;

  const command = buildAgentSubcommand({
    providerId,
    providerConfig,
    subcommand: 'unarchive',
    subcommandArgs: [threadId],
  });

  try {
    await ctx.exec(command.command, command.args, {
      timeout: CODEX_UNARCHIVE_TIMEOUT_MS,
      maxBuffer: CODEX_UNARCHIVE_MAX_BUFFER,
    });
  } catch (error) {
    log.warn('ensureCodexThreadUnarchived: failed to unarchive Codex thread', {
      threadId,
      error: String(error),
    });
  }
}
