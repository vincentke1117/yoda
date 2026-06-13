import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AutomationCreateInput, AutomationUpdateInput } from '@shared/automation';
import { automationsUpdatedChannel } from '@shared/events/appEvents';
import { events, rpc } from '@renderer/lib/ipc';

export const automationsQueryKey = ['automations'] as const;

export function useAutomations() {
  const queryClient = useQueryClient();

  // Live updates: any create/update/delete invalidates the list.
  useEffect(() => {
    return events.on(automationsUpdatedChannel, () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: automationsQueryKey,
    queryFn: () => rpc.automation.list(),
  });
}

export function useCreateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AutomationCreateInput) => rpc.automation.create(input),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    },
  });
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AutomationUpdateInput }) =>
      rpc.automation.update(id, patch),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    },
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc.automation.delete(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: automationsQueryKey });
    },
  });
}
