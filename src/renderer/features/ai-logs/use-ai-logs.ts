import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AiLogListInput } from '@shared/ai-logs';
import { aiLogUpdatedChannel } from '@shared/events/appEvents';
import { events, rpc } from '@renderer/lib/ipc';

export const aiLogsQueryKey = ['aiLogs'] as const;

export function useAiLogs(input: AiLogListInput) {
  const queryClient = useQueryClient();

  // Live updates: any inserted/updated log row invalidates the list, so
  // running invocations appear the moment they start.
  useEffect(() => {
    return events.on(aiLogUpdatedChannel, () => {
      void queryClient.invalidateQueries({ queryKey: aiLogsQueryKey });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: [...aiLogsQueryKey, input.status ?? 'all', input.mode ?? 'all'],
    queryFn: () => rpc.aiLogs.list(input),
  });
}

export function useClearAiLogs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc.aiLogs.clear(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiLogsQueryKey });
    },
  });
}
