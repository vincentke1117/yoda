import type {
  FeatureArtifactCreateInput,
  FeatureArtifactUpdateInput,
  FeatureCreateInput,
  FeatureUpdateInput,
} from '@shared/features';
import { createRPCController } from '@shared/ipc/rpc';
import { featureService } from './feature-service';

export const featureController = createRPCController({
  list: (projectId: string) => featureService.list(projectId),
  get: (projectId: string, featureId: string) => featureService.get(projectId, featureId),
  create: (input: FeatureCreateInput) => featureService.create(input),
  update: (projectId: string, featureId: string, input: FeatureUpdateInput) =>
    featureService.update(projectId, featureId, input),
  advance: (projectId: string, featureId: string) => featureService.advance(projectId, featureId),
  retreat: (projectId: string, featureId: string) => featureService.retreat(projectId, featureId),
  setTaskLinked: (projectId: string, featureId: string, taskId: string, linked: boolean) =>
    featureService.setTaskLinked(projectId, featureId, taskId, linked),
  addArtifact: (projectId: string, featureId: string, input: FeatureArtifactCreateInput) =>
    featureService.addArtifact(projectId, featureId, input),
  updateArtifact: (
    projectId: string,
    featureId: string,
    artifactId: string,
    input: FeatureArtifactUpdateInput
  ) => featureService.updateArtifact(projectId, featureId, artifactId, input),
  removeArtifact: (projectId: string, featureId: string, artifactId: string) =>
    featureService.removeArtifact(projectId, featureId, artifactId),
});
