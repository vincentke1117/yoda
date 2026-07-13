import { appState } from '@renderer/lib/stores/app-state';

export function openFeature(projectId: string, featureId?: string): void {
  appState.appTabs.openTab('project', {
    projectId,
    view: 'features',
    ...(featureId ? { featureId } : {}),
  });
}
