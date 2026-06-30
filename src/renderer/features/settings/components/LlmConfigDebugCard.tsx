import { Bug, CheckCircle2, Loader2, Send, XCircle } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GlobalLlmDebugProvider, GlobalLlmDebugResult } from '@shared/global-llm';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import { useMaasConnections } from '@renderer/features/maas/useMaas';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { MicroLabel } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const DEFAULT_AGENT_VALUE = '__default__';

export const LlmConfigDebugCard: React.FC = () => {
  const { t } = useTranslation();
  const {
    value: llm,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('llm');
  const { agents, isLoading: agentsLoading } = useAgents();
  const { data: maasConnections } = useMaasConnections();
  const [debugProvider, setDebugProvider] = useState<GlobalLlmDebugProvider>('auto');
  const [debugPrompt, setDebugPrompt] = useState(() => t('settings.llm.debugDefaultPrompt'));
  const [debugResult, setDebugResult] = useState<GlobalLlmDebugResult | null>(null);
  const [debugging, setDebugging] = useState(false);

  const settings = {
    maasEnabled: llm?.maasEnabled ?? false,
    maasModel: llm?.maasModel ?? '',
    agentEnabled: llm?.agentEnabled ?? true,
    agentId: llm?.agentId ?? '',
    preferredProvider: llm?.preferredProvider ?? 'maas',
    promptTranslationEnabled: llm?.promptTranslationEnabled ?? false,
    promptTranslationShowOriginal: llm?.promptTranslationShowOriginal ?? true,
  } as const;

  const connectedMaasCount =
    maasConnections?.filter((connection) => connection.connected).length ?? 0;
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === settings.agentId) ?? null,
    [agents, settings.agentId]
  );
  const disabled = loading || saving;

  const runDebug = () => {
    const prompt = debugPrompt.trim();
    if (!prompt || debugging) return;
    setDebugging(true);
    setDebugResult(null);
    void rpc.llm
      .debug({ prompt, provider: debugProvider })
      .then(setDebugResult)
      .catch((error: Error) =>
        setDebugResult({
          success: false,
          provider: null,
          model: null,
          output: '',
          durationMs: 0,
          error: error.message,
        })
      )
      .finally(() => setDebugging(false));
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3">
        <SettingRow
          title={t('settings.llm.useMaas')}
          description={t('settings.llm.useMaasDescription', { count: connectedMaasCount })}
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('maasEnabled')}
                defaultLabel="off"
                onReset={() => resetField('maasEnabled')}
                disabled={disabled}
              />
              <Switch
                checked={settings.maasEnabled}
                disabled={disabled}
                onCheckedChange={(checked) => update({ maasEnabled: checked })}
              />
            </>
          }
        />
        <SettingRow
          title={t('settings.llm.useAgent')}
          description={t('settings.llm.useAgentDescription')}
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('agentEnabled')}
                defaultLabel="on"
                onReset={() => resetField('agentEnabled')}
                disabled={disabled}
              />
              <Switch
                checked={settings.agentEnabled}
                disabled={disabled}
                onCheckedChange={(checked) => update({ agentEnabled: checked })}
              />
            </>
          }
        />
        <SettingRow
          title={t('settings.llm.preferredProvider')}
          description={t('settings.llm.preferredProviderDescription')}
          control={
            <Select
              value={settings.preferredProvider}
              onValueChange={(value) =>
                update({ preferredProvider: value === 'agent' ? 'agent' : 'maas' })
              }
              disabled={disabled}
            >
              <SelectTrigger className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="maas">{t('settings.llm.providerMaasFirst')}</SelectItem>
                <SelectItem value="agent">{t('settings.llm.providerAgentFirst')}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <SettingRow
          title={t('settings.llm.maasModel')}
          description={t('settings.llm.maasModelDescription')}
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('maasModel')}
                defaultLabel={t('settings.llm.autoModel')}
                onReset={() => resetField('maasModel')}
                disabled={disabled}
              />
              <Input
                key={settings.maasModel}
                defaultValue={settings.maasModel}
                disabled={disabled || !settings.maasEnabled}
                placeholder={t('settings.llm.maasModelPlaceholder')}
                className="h-8 w-64"
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next !== settings.maasModel) update({ maasModel: next });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </>
          }
        />
        <SettingRow
          title={t('settings.llm.agent')}
          description={t('settings.llm.agentDescription')}
          control={
            <Select
              value={settings.agentId || DEFAULT_AGENT_VALUE}
              onValueChange={(value) => {
                if (!value) return;
                update({ agentId: value === DEFAULT_AGENT_VALUE ? '' : value });
              }}
              disabled={disabled || !settings.agentEnabled || agentsLoading}
            >
              <SelectTrigger className="h-8 w-56">
                <SelectValue>
                  {() =>
                    selectedAgent
                      ? (selectedAgent.name ?? selectedAgent.id)
                      : t('settings.llm.agentDefault')
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_AGENT_VALUE}>
                  {t('settings.llm.agentDefault')}
                </SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id} label={agent.name ?? agent.id}>
                    {agent.name ?? agent.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <SettingRow
          title={t('settings.llm.promptTranslation')}
          description={t('settings.llm.promptTranslationDescription')}
          control={
            <Switch
              checked={settings.promptTranslationEnabled}
              disabled={disabled}
              onCheckedChange={(checked) => update({ promptTranslationEnabled: checked })}
            />
          }
        />
        <SettingRow
          title={t('settings.llm.showOriginalPrompt')}
          description={t('settings.llm.showOriginalPromptDescription')}
          control={
            <Switch
              checked={settings.promptTranslationShowOriginal}
              disabled={disabled || !settings.promptTranslationEnabled}
              onCheckedChange={(checked) => update({ promptTranslationShowOriginal: checked })}
            />
          }
        />
      </div>

      <Separator />

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bug className="size-4 shrink-0 text-foreground-muted" />
            <h3 className="text-sm font-normal text-foreground">{t('settings.llm.debugTitle')}</h3>
          </div>
          <Select
            value={debugProvider}
            onValueChange={(value) => setDebugProvider(value as GlobalLlmDebugProvider)}
            disabled={debugging}
          >
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('settings.llm.debugProviderAuto')}</SelectItem>
              <SelectItem value="maas">{t('settings.llm.debugProviderMaas')}</SelectItem>
              <SelectItem value="agent">{t('settings.llm.debugProviderAgent')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <MicroLabel className="text-foreground-passive">
            {t('settings.llm.debugPrompt')}
          </MicroLabel>
          <Textarea
            value={debugPrompt}
            onChange={(event) => setDebugPrompt(event.target.value)}
            className="min-h-24 resize-y"
            disabled={debugging}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-foreground-passive">{t('settings.llm.debugHint')}</span>
            <Button
              type="button"
              size="sm"
              onClick={runDebug}
              disabled={debugging || !debugPrompt.trim()}
            >
              {debugging ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              {debugging ? t('settings.llm.debugRunning') : t('settings.llm.debugRun')}
            </Button>
          </div>
        </div>
        {debugResult && (
          <div
            className={cn(
              'flex min-w-0 flex-col gap-2 rounded-md border p-3',
              debugResult.success
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-destructive/20 bg-destructive/5'
            )}
          >
            <div className="flex min-w-0 items-center gap-2 text-xs">
              {debugResult.success ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
              ) : (
                <XCircle className="size-3.5 shrink-0 text-destructive" />
              )}
              <span className="truncate text-foreground-muted">
                {debugResult.success
                  ? t('settings.llm.debugSuccess', {
                      provider: debugResult.provider ?? '-',
                      model: debugResult.model ?? '-',
                      duration: debugResult.durationMs,
                    })
                  : t('settings.llm.debugFailed', {
                      error: debugResult.error ?? t('common.unknownError'),
                    })}
              </span>
            </div>
            {debugResult.output && (
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-2 text-xs text-foreground">
                {debugResult.output}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
