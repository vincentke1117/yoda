import type { GlobalLlmSettings } from '@shared/app-settings';
import {
  getGlobalLlmRouteOrder,
  type GlobalLlmDebugInput,
  type GlobalLlmDebugProvider,
  type GlobalLlmDebugResult,
  type GlobalLlmProvider,
} from '@shared/global-llm';
import { createRPCController } from '@shared/ipc/rpc';
import { requestOpenAiCompatibleChat } from '@main/core/maas/openai-compatible-chat';
import { appSettingsService } from '@main/core/settings/settings-service';
import { requestUtilityAgentText } from '@main/core/tasks/name-generation/task-naming-service';

const MAX_DEBUG_PROMPT_CHARS = 8_000;
const DEBUG_TIMEOUT_MS = 60_000;

async function debug(input: GlobalLlmDebugInput): Promise<GlobalLlmDebugResult> {
  const startedAt = Date.now();
  const prompt = input.prompt.trim();
  if (!prompt) {
    return failedResult('Debug prompt is empty.', Date.now() - startedAt);
  }

  const settings = await appSettingsService.get('llm');
  const routes = getDebugRoutes(input.provider ?? 'auto', settings);
  if (routes.length === 0) {
    return failedResult('No global LLM route is enabled.', Date.now() - startedAt);
  }

  const clippedPrompt = prompt.slice(0, MAX_DEBUG_PROMPT_CHARS);
  const errors: string[] = [];

  for (const provider of routes) {
    try {
      if (provider === 'maas') {
        const result = await requestOpenAiCompatibleChat({
          model: settings.maasModel,
          messages: [{ role: 'user', content: clippedPrompt }],
          maxTokens: 800,
          temperature: 0.2,
          timeoutMs: DEBUG_TIMEOUT_MS,
          purpose: 'llm-debug',
        });
        if (!result) throw new Error('MaaS chat is not connected or returned no content.');
        return {
          success: true,
          provider,
          model: result.model,
          output: result.content,
          durationMs: Date.now() - startedAt,
        };
      }

      const result = await requestUtilityAgentText({
        prompt: clippedPrompt,
        cwd: process.cwd(),
        purpose: 'llm-debug',
        agentId: settings.agentId || undefined,
      });
      return {
        success: true,
        provider,
        model: result.model || null,
        output: result.text,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return failedResult(errors.join('; '), Date.now() - startedAt);
}

function getDebugRoutes(
  provider: GlobalLlmDebugProvider,
  settings: GlobalLlmSettings
): GlobalLlmProvider[] {
  if (provider === 'auto') return getGlobalLlmRouteOrder(settings);
  if (provider === 'maas') return settings.maasEnabled ? ['maas'] : [];
  return settings.agentEnabled ? ['agent'] : [];
}

function failedResult(error: string, durationMs: number): GlobalLlmDebugResult {
  return {
    success: false,
    provider: null,
    model: null,
    output: '',
    durationMs,
    error,
  };
}

export const llmController = createRPCController({
  debug,
});
