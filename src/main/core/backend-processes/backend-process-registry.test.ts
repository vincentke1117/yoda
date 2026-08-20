import { afterEach, describe, expect, it } from 'vitest';
import type { AppBackendProcessResource } from '@shared/app-resource';
import { backendProcessRegistry } from './backend-process-registry';

function processInfo(
  overrides: Partial<AppBackendProcessResource> = {}
): AppBackendProcessResource {
  return {
    id: 'app-1',
    kind: 'app-preview',
    label: 'My App',
    projectId: 'project-1',
    projectName: 'Project',
    url: 'http://127.0.0.1:5173/',
    pid: 1234,
    detachable: false,
    ...overrides,
  };
}

describe('backendProcessRegistry', () => {
  afterEach(() => {
    for (const info of backendProcessRegistry.list()) {
      backendProcessRegistry.unregister(`test:${info.id}`);
    }
  });

  it('registers and unregisters processes by key', () => {
    backendProcessRegistry.register('test:app-1', processInfo());
    expect(backendProcessRegistry.list()).toHaveLength(1);
    expect(backendProcessRegistry.list()[0].label).toBe('My App');

    backendProcessRegistry.unregister('test:app-1');
    expect(backendProcessRegistry.list()).toHaveLength(0);
  });

  it('isolates entries by key', () => {
    backendProcessRegistry.register('test:app-1', processInfo({ id: 'app-1' }));
    backendProcessRegistry.register('test:metro', processInfo({ id: 'metro', kind: 'metro' }));
    expect(backendProcessRegistry.list()).toHaveLength(2);

    backendProcessRegistry.unregister('test:app-1');
    expect(backendProcessRegistry.list().map((process) => process.id)).toEqual(['metro']);
  });

  it('computes running/keepable/nonKeepable summary', () => {
    backendProcessRegistry.register('test:app-1', processInfo({ id: 'app-1', detachable: false }));
    backendProcessRegistry.register(
      'test:metro',
      processInfo({ id: 'metro', kind: 'metro', detachable: true })
    );

    const summary = backendProcessRegistry.getActiveSessionSummary();
    expect(summary.running).toBe(2);
    expect(summary.keepable).toBe(1);
    expect(summary.nonKeepableSessions.map((session) => session.id)).toEqual(['app-1']);
  });
});
