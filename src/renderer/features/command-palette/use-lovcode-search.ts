import { useQuery } from '@tanstack/react-query';
import type { LovcodeSearchResult } from '@shared/lovcode';
import { rpc } from '@renderer/lib/ipc';

export function useLovcodeSearch(
  projectId: string | undefined,
  projectPath: string | null,
  query: string,
  enabled: boolean
): { data: LovcodeSearchResult | undefined; isFetching: boolean } {
  const trimmed = query.trim();
  const active = enabled && Boolean(projectId) && Boolean(projectPath) && trimmed.length > 0;

  const { data, isFetching } = useQuery<LovcodeSearchResult>({
    queryKey: ['lovcode-search', projectId, projectPath, trimmed],
    queryFn: () => rpc.lovcode.search(projectId!, projectPath!, trimmed),
    enabled: active,
    staleTime: 30_000,
  });

  return { data, isFetching };
}
