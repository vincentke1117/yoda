import { isTeamMemberEnabled, type AgentTeamMember } from '../agent-team';
import type { ParadigmKindId } from './contract';

/**
 * The user-facing single/team category is a projection of the roster, never a
 * persisted fact. `kindId` still identifies how params are stored and launched;
 * this function prevents that protocol detail from becoming stale UI state.
 */
export function paradigmKindByRoster(
  storedKindId: ParadigmKindId,
  members: readonly AgentTeamMember[]
): ParadigmKindId {
  if (storedKindId !== 'single' && storedKindId !== 'team') return storedKindId;
  const enabledCount = members.filter(isTeamMemberEnabled).length;
  return enabledCount >= 2 ? 'team' : 'single';
}
