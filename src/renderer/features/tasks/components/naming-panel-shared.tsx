import type { TFunction } from 'i18next';
import { ChevronRight, SlidersHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskNamingContextSnapshot } from '@shared/task-naming';
import { ManualRenameForm } from '@renderer/features/tasks/components/manual-rename-form';
import { NamingConfigFields } from '@renderer/features/tasks/components/naming-config-fields';
import {
  formatNamingDebugTokenCount,
  NamingDebugPanel,
  type NamingDebugContextSection,
  type NamingDebugContextStats,
  type NamingDebugSummaryItem,
  type NamingDebugTextSection,
} from '@renderer/features/tasks/components/naming-debug-ui';
import {
  PersistedDetails,
  usePersistedDisclosure,
} from '@renderer/features/tasks/components/persisted-disclosure';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@renderer/lib/ui/tabs';

/**
 * Normalized view of either a task or a conversation naming snapshot. The two
 * raw snapshot types name their generated field differently (generatedTaskName
 * vs generatedTitle) and the conversation one carries extra prompt text; this
 * shape erases those accidental differences so both panels render identically.
 */
export type UnifiedNamingView = {
  statusLabel: string;
  accent: boolean;
  model: string;
  durationLabel: string;
  timeoutLabel?: string;
  contextTokens: number | undefined;
  currentName: string;
  generatedName: string;
  /** Generated branch slug if known, else the live branch name. */
  branchName: string;
};

/**
 * Builds the summary rows shared by the task and conversation naming panels.
 * Branch name is always shown — conversations live in the same worktree and can
 * perceive the current branch just like tasks.
 */
export function buildNamingSummaryItems(
  t: TFunction,
  view: UnifiedNamingView
): NamingDebugSummaryItem[] {
  const items: NamingDebugSummaryItem[] = [
    { label: t('tasks.rename.status'), value: view.statusLabel, accent: view.accent },
    { label: t('tasks.panel.model'), value: view.model, mono: true },
    { label: t('tasks.rename.durationEstimate'), value: view.durationLabel, mono: true },
  ];
  if (view.timeoutLabel) {
    items.push({
      label: t('settings.tasks.namingTimeoutLabel'),
      value: view.timeoutLabel,
      mono: true,
    });
  }
  items.push(
    {
      label: t('tasks.rename.contextTokens'),
      value: formatNamingDebugTokenCount(view.contextTokens),
      mono: true,
    },
    { kind: 'divider' },
    { label: t('tasks.rename.currentTaskName'), value: view.currentName },
    { label: t('tasks.rename.generatedTaskName'), value: view.generatedName },
    { label: t('tasks.rename.generatedBranchName'), value: view.branchName, mono: true }
  );
  return items;
}

/**
 * Builds the system-prompt / final-prompt disclosure sections shared by both
 * panels. Returns empty when the snapshot has no prompt text yet.
 */
export function buildNamingTextSections(
  t: TFunction,
  idPrefix: string,
  prompts: {
    systemPrompt?: string;
    systemPromptTokens?: number;
    prompt?: string;
    promptTokens?: number;
  }
): NamingDebugTextSection[] {
  return [
    {
      id: `${idPrefix}:system-prompt`,
      label: t('tasks.sessionInfo.systemPrompt'),
      text: prompts.systemPrompt,
      tokenLabel: t('tasks.rename.sourceTokens', { count: prompts.systemPromptTokens ?? 0 }),
      maxHeightClassName: 'max-h-48',
    },
    {
      id: `${idPrefix}:final-prompt`,
      label: t('tasks.sessionInfo.finalPrompt'),
      text: prompts.prompt,
      tokenLabel: t('tasks.rename.sourceTokens', { count: prompts.promptTokens ?? 0 }),
      maxHeightClassName: 'max-h-48',
    },
  ];
}

/**
 * The collapsible configuration block shared by the naming and summary panels.
 * Defaults to the naming fields/hint; pass `children`/`hint` for other panels.
 */
export function NamingPanelConfiguration({
  id,
  t,
  hint,
  children,
}: {
  id: string;
  t: TFunction;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <PersistedDetails
      id={id}
      className="group min-w-0 rounded-md border border-border"
      summary={
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-xs text-foreground-passive transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
          <SlidersHorizontal className="size-3" />
          <span className="font-medium">{t('tasks.rename.configure')}</span>
        </summary>
      }
    >
      <div className="flex flex-col gap-2 border-t border-border/70 px-2 pb-2 pt-2">
        <p className="text-[11px] leading-relaxed text-foreground-passive">
          {hint ?? t('tasks.rename.configureHint')}
        </p>
        {children ?? <NamingConfigFields compact />}
      </div>
    </PersistedDetails>
  );
}

/** Shared context-section builder so both panels show identical source stats. */
export function buildNamingContextSection(
  t: TFunction,
  input: {
    context: TaskNamingContextSnapshot | null;
    isLoading: boolean;
    sourceIdPrefix: string;
    contextStats: NamingDebugContextStats | null;
    usingPreview?: boolean;
  }
): NamingDebugContextSection {
  return {
    title: input.usingPreview
      ? t('tasks.rename.currentContextSources')
      : t('tasks.rename.contextSources'),
    statsLabel: input.contextStats
      ? t('tasks.rename.contextStats', input.contextStats)
      : t('tasks.rename.contextStatsUnavailable'),
    isLoading: input.isLoading,
    loadingLabel: t('common.loading'),
    sources: input.context?.sources,
    emptyContent: (
      <span className="font-medium text-foreground-muted">{t('tasks.panel.noRenameContext')}</span>
    ),
    sourceIdPrefix: input.sourceIdPrefix,
    sourceTokenLabel: (source) => t('tasks.rename.sourceTokens', { count: source.estimatedTokens }),
    truncatedLabel: t('tasks.panel.truncated'),
  };
}

type NamingDebugPanelProps = Omit<React.ComponentProps<typeof NamingDebugPanel>, 'sectionLabels'>;

/**
 * The unified naming panel used by both the task and conversation surfaces. A
 * Tabs control splits manual rename (a simple input) from the AI naming debug
 * view, so both panels are structurally identical and differ only by data
 * source. The active tab is remembered per `tabStateId` (defaults to manual).
 */
export const NamingPanel = observer(function NamingPanel({
  tabStateId,
  manual,
  manualContent,
  autoPanel,
  sectionLabels,
}: {
  /** Stable id for remembering which tab is active. */
  tabStateId: string;
  manual?: {
    currentName: string;
    onRename: (name: string) => Promise<void>;
    getConflicts?: () => Set<string>;
    showBranchPreview?: boolean;
  };
  /** Custom manual-tab body (e.g. the summary textarea). Wins over `manual`. */
  manualContent?: React.ReactNode;
  autoPanel: NamingDebugPanelProps;
  /** Section heading overrides; defaults to the naming basics/config labels. */
  sectionLabels?: { basics: string; configuration: string };
}) {
  const { t } = useTranslation();
  // Reuse the disclosure store as a 2-state tab memory: open === "auto" tab.
  // Local state drives the controlled Tabs so the switch is instant; the store
  // write is a side effect (its async persist must not gate the UI update).
  const [persistedAuto, setPersistedAuto] = usePersistedDisclosure(tabStateId, false);
  const [value, setValue] = useState<'manual' | 'auto'>(persistedAuto ? 'auto' : 'manual');

  const selectTab = (next: 'manual' | 'auto') => {
    setValue(next);
    setPersistedAuto(next === 'auto');
  };

  return (
    <Tabs value={value} onValueChange={(next) => selectTab(next as 'manual' | 'auto')}>
      <TabsList>
        <TabsIndicator />
        <TabsTab value="manual">{t('tasks.rename.tabManual')}</TabsTab>
        <TabsTab value="auto">{t('tasks.rename.tabAuto')}</TabsTab>
      </TabsList>
      <TabsPanel value="manual">
        {manualContent ??
          (manual ? (
            <ManualRenameForm
              currentName={manual.currentName}
              onRename={manual.onRename}
              getConflicts={manual.getConflicts}
              showBranchPreview={manual.showBranchPreview}
            />
          ) : null)}
      </TabsPanel>
      <TabsPanel value="auto" className="flex min-h-0 flex-1 flex-col">
        <NamingDebugPanel
          {...autoPanel}
          sectionLabels={
            sectionLabels ?? {
              basics: t('tasks.rename.sectionBasics'),
              configuration: t('tasks.rename.sectionConfig'),
            }
          }
        />
      </TabsPanel>
    </Tabs>
  );
});
