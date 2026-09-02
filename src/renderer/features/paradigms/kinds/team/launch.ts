import { enabledTeamMembers, type AgentTeam, type AgentTeamMember } from '@shared/agent-team';
import { paradigmSlot, teamParadigmKind } from '@shared/paradigms/kinds';
import { withParadigmSlotAgent } from '@shared/paradigms/params';
import { defaultParadigmStamp } from '@shared/paradigms/stamp';
import { teamToParadigmParams } from '@shared/paradigms/team-adapter';
import { invalidateTeamRoomQueries } from '@renderer/features/agent-room/team-room-queries';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { requirementPromptBuilder } from '../../agent-launch-settings';
import { launchableSlot, type ParadigmLauncher } from '../../launch-context';

const SINGLE_AGENT_SLOT = paradigmSlot('single', 'agent').storageKey;

function soleReferencedMember(team: AgentTeam): (AgentTeamMember & { agentRef: string }) | null {
  const members = enabledTeamMembers(team);
  const member = members.length === 1 ? members[0] : undefined;
  return member?.agentRef ? (member as AgentTeamMember & { agentRef: string }) : null;
}

/**
 * An Agent Team instantiated on one task. The task itself carries no session —
 * the room conductor drives @-routing between members.
 */
export const teamLauncher: ParadigmLauncher = {
  descriptor: teamParadigmKind,
  // A team *is* a paradigm instance, so the stamp names the real one rather than
  // a synthesized built-in — the only kind where that is true today.
  stamp: (params) => {
    if (!params.team) return defaultParadigmStamp('team');
    const sole = soleReferencedMember(params.team);
    if (sole) {
      const stamp = defaultParadigmStamp('single');
      return {
        ...stamp,
        paradigmParams: withParadigmSlotAgent(
          stamp.paradigmParams,
          SINGLE_AGENT_SLOT,
          sole.agentRef
        ),
      };
    }
    return {
      paradigmId: params.team.id,
      paradigmKind: 'team',
      paradigmParams: teamToParadigmParams(params.team),
    };
  },
  async launch(ctx, params) {
    const team = params.team;
    if (!team) return;
    const sole = soleReferencedMember(team);
    if (sole) {
      const slot = launchableSlot(ctx.resolveMember(sole));
      if (!slot) return;
      const buildPrompt = requirementPromptBuilder(slot.systemPrompt);
      const launch = ctx.launchAgent({ slot, buildPrompt });
      ctx.focusTask(launch.projectId, launch.taskId);
      ctx.scheduleDeferredPrompt(launch, buildPrompt);
      ctx.reportLaunchFailure(launch.promise);
      ctx.finish();
      return;
    }
    const task = ctx.launchBareTask();
    ctx.focusTask(task.projectId, task.taskId);
    try {
      await task.promise;
      // The conductor writes into the task's worktree, so it must exist first.
      ctx.assertTaskReady(task);
      const requirement = await ctx.resolveRequirement();
      if (requirement === null) return;
      await rpc.teamRooms.createRoomFromTeam({
        projectId: task.projectId,
        taskId: task.taskId,
        teamId: team.id,
        requirement,
        // The shipped instance has no name of its own — it displays as the kind's
        // localized name, which main cannot resolve, so the room borrows it here.
        fallbackName: ctx.t(teamParadigmKind.labelKey),
      });
      await invalidateTeamRoomQueries(ctx.queryClient, task.projectId, task.taskId);
      ctx.finish();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Agent team orchestration failed.');
    }
  },
};
