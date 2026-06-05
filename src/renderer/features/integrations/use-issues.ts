import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IssueProviderType } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { rpc } from '@renderer/lib/ipc';

const INITIAL_FETCH_LIMIT = 50;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

const SEARCH_MIN_LENGTH_BY_PROVIDER: Partial<Record<IssueProviderType, number>> = {
  plain: 2,
};

export interface UseIssuesResult {
  issues: Issue[];
  isLoading: boolean;
  error: string | null;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  isSearching: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  syncCreatedIssue: (issue: Issue) => void;
}

interface UseIssuesOptions {
  projectId?: string;
  projectPath?: string;
  repositoryUrl?: string;
  enabled?: boolean;
  initialLimit?: number;
  searchLimit?: number;
}

function getSearchMinLength(provider: IssueProviderType | null): number {
  if (!provider) return 1;
  return SEARCH_MIN_LENGTH_BY_PROVIDER[provider] ?? 1;
}

function getIssueCacheKey(issue: Issue): string {
  return issue.url || `${issue.provider}:${issue.identifier}`;
}

function upsertCreatedIssue(
  issues: Issue[] | undefined,
  createdIssue: Issue,
  limit: number
): Issue[] {
  const createdIssueKey = getIssueCacheKey(createdIssue);
  const nextIssues = [
    createdIssue,
    ...(issues ?? []).filter((issue) => getIssueCacheKey(issue) !== createdIssueKey),
  ];

  return nextIssues.slice(0, limit);
}

function issueMatchesSearch(issue: Issue, searchTerm: string): boolean {
  const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase();
  if (!normalizedSearchTerm) return true;

  return [issue.title, issue.identifier, issue.url].some((value) =>
    value.toLocaleLowerCase().includes(normalizedSearchTerm)
  );
}

export function useIssues(
  provider: IssueProviderType | null,
  {
    projectId,
    projectPath,
    repositoryUrl,
    enabled = true,
    initialLimit = INITIAL_FETCH_LIMIT,
    searchLimit = SEARCH_LIMIT,
  }: UseIssuesOptions = {}
): UseIssuesResult {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(searchTerm), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const isReady = enabled && !!provider;
  const initialQueryKey = useMemo(
    () =>
      [
        'issues:initial',
        provider,
        projectId ?? '',
        projectPath ?? '',
        repositoryUrl ?? '',
        initialLimit,
      ] as const,
    [initialLimit, projectId, projectPath, provider, repositoryUrl]
  );

  const initialQuery = useQuery({
    queryKey: initialQueryKey,
    queryFn: async () => {
      if (!provider) return [] as Issue[];

      const result = await rpc.issues.listIssues(provider, {
        limit: initialLimit,
        projectId,
        projectPath,
        repositoryUrl,
      });

      if (!result?.success) {
        throw new Error(result?.error ?? 'Failed to load issues.');
      }

      return result.issues ?? [];
    },
    staleTime: 60_000,
    enabled: isReady,
  });

  const {
    data: initialIssues,
    isLoading: isLoadingInitial,
    isFetching: isFetchingInitial,
    error: initialError,
    refetch: refetchInitialIssues,
  } = initialQuery;

  const minSearchLength = getSearchMinLength(provider);
  const normalizedDebouncedTerm = debouncedTerm.trim();
  const isActiveSearch = normalizedDebouncedTerm.length >= minSearchLength;
  const searchQueryKey = useMemo(
    () =>
      [
        'issues:search',
        provider,
        projectId ?? '',
        projectPath ?? '',
        repositoryUrl ?? '',
        normalizedDebouncedTerm,
        searchLimit,
      ] as const,
    [normalizedDebouncedTerm, projectId, projectPath, provider, repositoryUrl, searchLimit]
  );

  const searchQuery = useQuery({
    queryKey: searchQueryKey,
    queryFn: async () => {
      if (!provider) return [] as Issue[];

      const result = await rpc.issues.searchIssues(provider, {
        limit: searchLimit,
        searchTerm: normalizedDebouncedTerm,
        projectId,
        projectPath,
        repositoryUrl,
      });

      if (result?.success) {
        return result.issues ?? [];
      }

      return [] as Issue[];
    },
    staleTime: 30_000,
    enabled: isReady && isActiveSearch,
    placeholderData: keepPreviousData,
  });

  const { data: searchIssues, isFetching: isSearching, refetch: refetchSearchIssues } = searchQuery;

  const issues = useMemo<Issue[]>(() => {
    if (isActiveSearch) return searchIssues ?? [];
    return initialIssues ?? [];
  }, [initialIssues, isActiveSearch, searchIssues]);

  const error = initialError instanceof Error ? initialError.message : null;
  const refresh = useCallback(async () => {
    if (isActiveSearch) {
      await refetchSearchIssues();
      return;
    }

    await refetchInitialIssues();
  }, [isActiveSearch, refetchInitialIssues, refetchSearchIssues]);
  const applyCreatedIssueToCache = useCallback(
    (issue: Issue) => {
      queryClient.setQueryData<Issue[]>(initialQueryKey, (currentIssues) =>
        upsertCreatedIssue(currentIssues, issue, initialLimit)
      );

      if (!isActiveSearch || !issueMatchesSearch(issue, normalizedDebouncedTerm)) return;

      queryClient.setQueryData<Issue[]>(searchQueryKey, (currentIssues) =>
        upsertCreatedIssue(currentIssues, issue, searchLimit)
      );
    },
    [
      initialLimit,
      initialQueryKey,
      isActiveSearch,
      normalizedDebouncedTerm,
      queryClient,
      searchLimit,
      searchQueryKey,
    ]
  );
  const syncCreatedIssue = useCallback(
    (issue: Issue) => {
      applyCreatedIssueToCache(issue);
      void refresh()
        .catch(() => undefined)
        .then(() => applyCreatedIssueToCache(issue));
    },
    [applyCreatedIssueToCache, refresh]
  );

  return {
    issues,
    isLoading: isLoadingInitial,
    error,
    searchTerm,
    setSearchTerm,
    isSearching: isActiveSearch && isSearching,
    isRefreshing: isActiveSearch ? isSearching : isFetchingInitial && !isLoadingInitial,
    refresh,
    syncCreatedIssue,
  };
}
