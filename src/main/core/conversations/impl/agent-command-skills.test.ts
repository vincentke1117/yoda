import { describe, expect, it } from 'vitest';
import type { SkillSessionPolicy } from '@shared/skills/types';
import { runtimeConfigDefaults } from '@main/core/settings/schema';
import { buildAgentCommand } from './agent-command';

const skillPolicy: SkillSessionPolicy = {
  source: 'agent-profile',
  entries: [
    {
      key: 'docs',
      id: 'docs',
      path: '/skills/docs',
      contentHash: 'abc',
      mode: 'auto',
      scope: 'managed',
    },
  ],
  available: [
    { key: 'docs', id: 'docs', path: '/skills/docs', scope: 'managed' },
    { key: 'unused', id: 'unused', path: '/skills/unused', scope: 'user' },
  ],
  warnings: [],
  createdAt: new Date(0).toISOString(),
};

const emptySkillPolicy: SkillSessionPolicy = {
  ...skillPolicy,
  entries: [],
};

const unavailableSkillPolicy: SkillSessionPolicy = {
  ...emptySkillPolicy,
  warnings: ['Configured skill is unavailable: removed-skill'],
};

const explicitEmptyAllowlist: SkillSessionPolicy = {
  ...emptySkillPolicy,
  restriction: 'allowlist',
};

describe('buildAgentCommand skill policy integration', () => {
  it('merges Claude theme and per-session skill overrides into one settings payload', () => {
    const result = buildAgentCommand({
      runtimeId: 'claude',
      providerConfig: runtimeConfigDefaults.claude,
      sessionId: 'session-1',
      terminalThemeMode: 'light',
      skillPolicy,
    });
    const settingsIndex = result.args.indexOf('--settings');
    expect(settingsIndex).toBeGreaterThan(-1);
    expect(JSON.parse(result.args[settingsIndex + 1])).toEqual({
      theme: 'light',
      skillOverrides: { docs: 'on', unused: 'off' },
    });
  });

  it('passes the captured exact path policy to Codex', () => {
    const result = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      sessionId: 'session-1',
      skillPolicy,
    });
    expect(result.args).toContain('-c');
    expect(result.args.find((arg) => arg.startsWith('skills.config='))).toContain(
      'path="/skills/docs/SKILL.md",enabled=true'
    );
    expect(result.args.find((arg) => arg.startsWith('skills.config='))).toContain(
      'path="/skills/unused/SKILL.md",enabled=false'
    );
  });

  it('does not disable every Codex skill for an empty persisted profile', () => {
    const result = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      sessionId: 'session-1',
      skillPolicy: emptySkillPolicy,
    });

    expect(result.args.some((arg) => arg.startsWith('skills.config='))).toBe(false);
  });

  it('does not disable every Claude skill for an empty persisted profile', () => {
    const result = buildAgentCommand({
      runtimeId: 'claude',
      providerConfig: runtimeConfigDefaults.claude,
      sessionId: 'session-1',
      terminalThemeMode: 'light',
      skillPolicy: emptySkillPolicy,
    });
    const settingsIndex = result.args.indexOf('--settings');

    expect(JSON.parse(result.args[settingsIndex + 1])).toEqual({ theme: 'light' });
  });

  it.each([
    ['a legacy unavailable selection', unavailableSkillPolicy],
    ['an explicit empty allowlist', explicitEmptyAllowlist],
  ])('keeps Codex fail-closed for %s', (_label, policy) => {
    const result = buildAgentCommand({
      runtimeId: 'codex',
      providerConfig: runtimeConfigDefaults.codex,
      sessionId: 'session-1',
      skillPolicy: policy,
    });
    const config = result.args.find((arg) => arg.startsWith('skills.config='));

    expect(config).toContain('path="/skills/docs/SKILL.md",enabled=false');
    expect(config).toContain('path="/skills/unused/SKILL.md",enabled=false');
  });

  it.each([
    ['a legacy unavailable selection', unavailableSkillPolicy],
    ['an explicit empty allowlist', explicitEmptyAllowlist],
  ])('keeps Claude fail-closed for %s', (_label, policy) => {
    const result = buildAgentCommand({
      runtimeId: 'claude',
      providerConfig: runtimeConfigDefaults.claude,
      sessionId: 'session-1',
      skillPolicy: policy,
    });
    const settingsIndex = result.args.indexOf('--settings');

    expect(JSON.parse(result.args[settingsIndex + 1])).toEqual({
      skillOverrides: { docs: 'off', unused: 'off' },
    });
  });
});
