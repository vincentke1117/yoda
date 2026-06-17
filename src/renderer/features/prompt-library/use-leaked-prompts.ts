import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { leakedPromptsUpdatedChannel } from '@shared/events/appEvents';
import { events, rpc } from '@renderer/lib/ipc';

export const leakedPromptsQueryKey = ['leaked-prompts'] as const;

export function useLeakedPrompts() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return events.on(leakedPromptsUpdatedChannel, () => {
      void queryClient.invalidateQueries({ queryKey: leakedPromptsQueryKey });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: leakedPromptsQueryKey,
    queryFn: () => rpc.leakedPrompts.list(),
    staleTime: Infinity,
  });
}

export function useRefreshLeakedPrompts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc.leakedPrompts.refresh(),
    onSuccess: (list) => queryClient.setQueryData(leakedPromptsQueryKey, list),
  });
}

export function useLeakedPromptContent(id: string | null) {
  return useQuery({
    queryKey: ['leaked-prompt-content', id],
    queryFn: () => rpc.leakedPrompts.getContent(id as string),
    enabled: id !== null,
    staleTime: Infinity,
  });
}
