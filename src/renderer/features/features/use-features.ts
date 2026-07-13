import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { featureUpdatedChannel } from '@shared/events/featureEvents';
import {
  taskArchivedChannel,
  taskRenamedChannel,
  taskStatusUpdatedChannel,
} from '@shared/events/taskEvents';
import type {
  FeatureArtifactCreateInput,
  FeatureArtifactUpdateInput,
  FeatureCreateInput,
  FeatureUpdateInput,
} from '@shared/features';
import { events, rpc } from '@renderer/lib/ipc';

export const featureListQueryKey = (projectId: string) => ['features', projectId] as const;
export const featureQueryKey = (projectId: string, featureId: string) =>
  ['feature', projectId, featureId] as const;

function useFeatureInvalidation(projectId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const invalidateProject = () => {
      void queryClient.invalidateQueries({ queryKey: featureListQueryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: ['feature', projectId] });
    };
    const disposeFeature = events.on(featureUpdatedChannel, (event) => {
      if (event.projectId !== projectId) return;
      void queryClient.invalidateQueries({ queryKey: featureListQueryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: featureQueryKey(projectId, event.featureId) });
    });
    const disposeStatus = events.on(taskStatusUpdatedChannel, (event) => {
      if (event.projectId === projectId) invalidateProject();
    });
    const disposeArchived = events.on(taskArchivedChannel, (event) => {
      if (event.projectId === projectId) invalidateProject();
    });
    const disposeRenamed = events.on(taskRenamedChannel, (event) => {
      if (event.projectId === projectId) invalidateProject();
    });
    return () => {
      disposeFeature();
      disposeStatus();
      disposeArchived();
      disposeRenamed();
    };
  }, [projectId, queryClient]);
}

export function useFeatures(projectId: string) {
  useFeatureInvalidation(projectId);
  return useQuery({
    queryKey: featureListQueryKey(projectId),
    queryFn: () => rpc.features.list(projectId),
  });
}

export function useFeature(projectId: string, featureId: string | undefined) {
  useFeatureInvalidation(projectId);
  return useQuery({
    queryKey: featureQueryKey(projectId, featureId ?? 'none'),
    enabled: Boolean(featureId),
    queryFn: () => rpc.features.get(projectId, featureId!),
  });
}

export function useCreateFeature() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FeatureCreateInput) => rpc.features.create(input),
    onSuccess: (feature) => {
      void queryClient.invalidateQueries({ queryKey: featureListQueryKey(feature.projectId) });
      queryClient.setQueryData(featureQueryKey(feature.projectId, feature.id), feature);
    },
  });
}

export function useFeatureMutations(projectId: string, featureId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: featureListQueryKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: featureQueryKey(projectId, featureId) });
  };

  return {
    update: useMutation({
      mutationFn: (input: FeatureUpdateInput) => rpc.features.update(projectId, featureId, input),
      onSettled: invalidate,
    }),
    advance: useMutation({
      mutationFn: () => rpc.features.advance(projectId, featureId),
      onSettled: invalidate,
    }),
    retreat: useMutation({
      mutationFn: () => rpc.features.retreat(projectId, featureId),
      onSettled: invalidate,
    }),
    setTaskLinked: useMutation({
      mutationFn: ({ taskId, linked }: { taskId: string; linked: boolean }) =>
        rpc.features.setTaskLinked(projectId, featureId, taskId, linked),
      onSettled: invalidate,
    }),
    addArtifact: useMutation({
      mutationFn: (input: FeatureArtifactCreateInput) =>
        rpc.features.addArtifact(projectId, featureId, input),
      onSettled: invalidate,
    }),
    updateArtifact: useMutation({
      mutationFn: ({
        artifactId,
        input,
      }: {
        artifactId: string;
        input: FeatureArtifactUpdateInput;
      }) => rpc.features.updateArtifact(projectId, featureId, artifactId, input),
      onSettled: invalidate,
    }),
    removeArtifact: useMutation({
      mutationFn: (artifactId: string) =>
        rpc.features.removeArtifact(projectId, featureId, artifactId),
      onSettled: invalidate,
    }),
  };
}
