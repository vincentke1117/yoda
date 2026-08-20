import { describe, expect, it } from 'vitest';
import { readRuntimeBarSource } from '@renderer/app/runtime-bar/test-helpers/read-bar-source';

describe('Workspace runtime bar Terminal ownership', () => {
  const source = readRuntimeBarSource();

  it('uses the quick-action project/global Terminal as its only state source', () => {
    expect(source).toContain('const workspaceTerminalOpen = workspaceTerminalStore.isOpen;');
    expect(source).not.toContain(
      'const terminalActive = taskTerminalActive || workspaceTerminalStore.isOpen;'
    );

    const openStart = source.indexOf('const openTerminalPanel = () => {');
    const openEnd = source.indexOf('\n  };', openStart);
    const openSource = source.slice(openStart, openEnd);

    expect(openSource).toContain(
      'workspaceTerminalStore.toggleForRuntimeBar(activeMountedProjectData)'
    );
    expect(openSource).not.toContain('workspaceTerminalStore.close()');
    expect(openSource).not.toContain('workspaceTerminalStore.toggleProject');
    expect(openSource).not.toContain('workspaceTerminalStore.toggleGlobal');
  });

  it('collapses a task Terminal hidden behind the quick-action Terminal', () => {
    expect(source).toContain(
      'if (!isOpen || !workspaceTerminalOpen || !taskTerminalVisible || !provisionedTask) return;'
    );
    expect(source).toContain('provisionedTask.taskView.setTerminalDrawerOpen(false);');
  });
});
