import { enabledTeamMembers } from '@shared/agent-team';
import { paradigmSlot, singleParadigmKind } from '@shared/paradigms/kinds';
import { withParadigmSlotAgent } from '@shared/paradigms/params';
import { defaultParadigmStamp } from '@shared/paradigms/stamp';
import { promptInvokesSkill } from '@renderer/features/projects/quick-action-source';
import { requirementPromptBuilder } from '../../agent-launch-settings';
import { launchableSlot, type ParadigmLauncher } from '../../launch-context';

const AGENT_SLOT = paradigmSlot('single', 'agent');

/**
 * Vibe coding: one Agent takes the requirement and works until the user says
 * otherwise. The baseline every other paradigm is a variation on.
 */
export const singleLauncher: ParadigmLauncher = {
  descriptor: singleParadigmKind,
  stamp(params) {
    const running = params.team ? enabledTeamMembers(params.team) : [];
    const sole = running.length === 1 ? running[0] : undefined;
    if (!params.team || !sole?.agentRef) return defaultParadigmStamp('single');
    return {
      paradigmId: params.team.id,
      paradigmKind: 'single',
      paradigmParams: withParadigmSlotAgent({}, AGENT_SLOT.storageKey, sole.agentRef),
    };
  },
  async launch(ctx, params) {
    const running = params.team ? enabledTeamMembers(params.team) : [];
    const sole = running.length === 1 ? running[0] : undefined;
    const slot = launchableSlot(
      sole ? ctx.resolveMember(sole) : ctx.resolveSlot(AGENT_SLOT.storageKey)
    );
    if (!slot) return;
    const buildPrompt = requirementPromptBuilder(slot.systemPrompt);
    const launch = ctx.launchAgent({
      slot,
      buildPrompt,
      // A quick action records what the user clicked so the task can show it.
      quickActionSource:
        params.quickAction && ctx.requirement
          ? { prompt: ctx.requirement, invokedSkill: promptInvokesSkill(ctx.requirement) }
          : undefined,
    });
    ctx.focusTask(launch.projectId, launch.taskId);
    ctx.scheduleDeferredPrompt(launch, buildPrompt);
    ctx.reportLaunchFailure(launch.promise);
    ctx.finish();
  },
};
