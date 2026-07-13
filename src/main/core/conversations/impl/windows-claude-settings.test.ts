import { describe, expect, it, vi } from 'vitest';
import { prepareWindowsClaudeSettings } from './windows-claude-settings';

describe('prepareWindowsClaudeSettings', () => {
  it('materializes inline Claude settings on Windows and cleans them up once', () => {
    const mkdtemp = vi.fn(() => 'C:\\Temp Root\\yoda-claude-settings-a');
    const writeFile = vi.fn();
    const removeDirectory = vi.fn();
    const settings = JSON.stringify({
      theme: 'dark',
      skillOverrides: { docs: 'on', unused: 'off' },
    });

    const prepared = prepareWindowsClaudeSettings('claude', ['--settings', settings], {
      platform: 'win32',
      mkdtemp,
      writeFile,
      removeDirectory,
    });

    expect(prepared.args).toEqual([
      '--settings',
      'C:\\Temp Root\\yoda-claude-settings-a\\settings.json',
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      'C:\\Temp Root\\yoda-claude-settings-a\\settings.json',
      settings,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );

    prepared.cleanup?.();
    prepared.cleanup?.();
    expect(removeDirectory).toHaveBeenCalledTimes(1);
    expect(removeDirectory).toHaveBeenCalledWith('C:\\Temp Root\\yoda-claude-settings-a');
  });

  it('leaves SSH-capable inline settings untouched outside the local Windows boundary', () => {
    const args = ['--settings', '{"theme":"light"}'];

    expect(prepareWindowsClaudeSettings('claude', args, { platform: 'linux' })).toEqual({ args });
    expect(prepareWindowsClaudeSettings('codex', args, { platform: 'win32' })).toEqual({ args });
  });

  it('does not replace a caller-provided settings file', () => {
    const mkdtemp = vi.fn();
    const args = ['--settings', 'C:\\Users\\mark\\settings.json'];

    expect(prepareWindowsClaudeSettings('claude', args, { platform: 'win32', mkdtemp })).toEqual({
      args,
    });
    expect(mkdtemp).not.toHaveBeenCalled();
  });

  it('isolates concurrent sessions in separate temporary directories', () => {
    const mkdtemp = vi
      .fn()
      .mockReturnValueOnce('C:\\Temp\\session-a')
      .mockReturnValueOnce('C:\\Temp\\session-b');
    const writeFile = vi.fn();
    const removeDirectory = vi.fn();
    const options = { platform: 'win32' as const, mkdtemp, writeFile, removeDirectory };

    const first = prepareWindowsClaudeSettings('claude', ['--settings', '{}'], options);
    const second = prepareWindowsClaudeSettings('claude', ['--settings', '{}'], options);

    expect(first.settingsPath).toBe('C:\\Temp\\session-a\\settings.json');
    expect(second.settingsPath).toBe('C:\\Temp\\session-b\\settings.json');
  });

  it('removes the temporary directory when writing settings fails', () => {
    const removeDirectory = vi.fn();

    expect(() =>
      prepareWindowsClaudeSettings('claude', ['--settings', '{}'], {
        platform: 'win32',
        mkdtemp: () => 'C:\\Temp\\failed',
        writeFile: () => {
          throw new Error('disk full');
        },
        removeDirectory,
      })
    ).toThrow('disk full');
    expect(removeDirectory).toHaveBeenCalledWith('C:\\Temp\\failed');
  });
});
