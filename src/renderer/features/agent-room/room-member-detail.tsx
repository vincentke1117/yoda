import { useQuery } from '@tanstack/react-query';
import { Loader2, TerminalSquare, Users } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomMember } from '@shared/team-room';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { ACCENT_AVATAR, STATUS_DOT, STATUS_LABEL } from './accent';
import { agentRoomStore } from './agent-room-store';
import { taskRoomQueryKey } from './task-room-chat';

const monogram = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

/** Look up a member in the (singleton) loaded room snapshot. */
function memberById(memberId: string): RoomMember | undefined {
  return agentRoomStore.snapshot?.members.find((m) => m.id === memberId);
}

/** Tab label + icon for a `room-member` tab; resolves the member from the loaded room. */
export function roomMemberTabMeta(memberId: string): { label: string; icon: ReactNode } {
  const member = memberById(memberId);
  if (!member) return { label: 'agent', icon: <Users className="size-3.5" /> };
  return {
    label: member.displayName,
    icon: (
      <span
        className={cn(
          'flex size-3.5 items-center justify-center rounded text-[8px] font-semibold',
          ACCENT_AVATAR[member.accent]
        )}
      >
        {monogram(member.displayName)}
      </span>
    ),
  };
}

/**
 * Content of a `room-member` tab — a room member's identity / instructions, with
 * a shortcut to open its live session. Rendered inside the provisioned task view
 * (sidebar pin or main area), so it can drive the task's TabManagerStore.
 */
export const RoomMemberDetail = observer(function RoomMemberDetail({
  memberId,
}: {
  memberId: string;
}) {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const { taskView } = useProvisionedTask();

  // Ensure the room is loaded even when the tab is restored without the chat
  // ever being opened (mirrors TaskRoomChat's load).
  const { data: room } = useQuery({
    queryKey: taskRoomQueryKey(projectId, taskId),
    queryFn: () => rpc.teamRooms.getRoomForTask(projectId, taskId),
  });
  const roomId = room?.room.id ?? null;
  useEffect(() => {
    if (roomId) void agentRoomStore.selectRoom(roomId);
  }, [roomId]);

  const member = memberById(memberId);
  if (!member) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-foreground-muted">
        <Loader2 className="size-4 animate-spin" /> loading agent…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl text-base font-semibold',
            ACCENT_AVATAR[member.accent]
          )}
        >
          {monogram(member.displayName)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{member.displayName}</div>
          <div className="flex items-center gap-2 text-xs text-foreground-muted">
            <span className="flex items-center gap-1">
              <span className={cn('size-2 rounded-full', STATUS_DOT[member.status])} />
              {STATUS_LABEL[member.status]}
            </span>
            <span className="font-mono">@{member.handle}</span>
          </div>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-foreground-muted">role</dt>
        <dd>{member.role}</dd>
        {member.runtime && (
          <>
            <dt className="text-foreground-muted">runtime</dt>
            <dd className="font-mono">{member.runtime}</dd>
          </>
        )}
      </dl>
      <div className="mt-4">
        <div className="mb-1 text-xs font-semibold text-foreground-muted">
          {t('agentRoom.member.instructions')}
        </div>
        <div className="whitespace-pre-wrap rounded-lg border border-border bg-background-1 p-3 text-xs leading-relaxed">
          {member.systemPrompt?.trim() ? member.systemPrompt : t('agentRoom.member.noInstructions')}
        </div>
      </div>
      {member.conversationId && (
        <button
          type="button"
          onClick={() => {
            if (!member.conversationId) return;
            taskView.tabManager.openConversationInSidebar(member.conversationId);
            taskView.setSidebarCollapsed(false);
          }}
          className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background-1 px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-primary hover:text-foreground"
        >
          <TerminalSquare className="size-3.5" /> {t('agentRoom.openSession')}
        </button>
      )}
    </div>
  );
});
