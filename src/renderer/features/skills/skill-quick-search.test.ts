import { describe, expect, it } from 'vitest';
import type { CatalogSkill } from '@shared/skills/types';
import { filterInstalledSkills, hasInstalledRuntimeName } from './skill-quick-search';

function skill(overrides: Partial<CatalogSkill>): CatalogSkill {
  return {
    key: 'skill:local:calendar:test',
    ref: {
      key: 'skill:local:calendar:test',
      id: 'calendar',
      source: 'local',
      locator: '/tmp/calendar',
    },
    id: 'calendar',
    displayName: 'Calendar',
    description: 'Manage meetings',
    source: 'local',
    scope: 'user',
    managed: false,
    frontmatter: { name: 'calendar', description: 'Manage meetings' },
    installed: true,
    ...overrides,
  };
}

describe('skill quick search', () => {
  it('searches only installed skills across name, id and description', () => {
    const skills = [
      skill({}),
      skill({ key: 'catalog', id: 'calendar-pro', displayName: 'Calendar Pro', installed: false }),
      skill({ key: 'notes', id: 'notes', displayName: 'Notes', description: 'Write drafts' }),
    ];

    expect(filterInstalledSkills(skills, 'meeting').map((item) => item.id)).toEqual(['calendar']);
    expect(filterInstalledSkills(skills, '').map((item) => item.id)).toEqual(['calendar', 'notes']);
  });

  it('detects same runtime names before external installation', () => {
    expect(hasInstalledRuntimeName([skill({})], 'calendar')).toBe(true);
    expect(hasInstalledRuntimeName([skill({})], 'calendar-pro')).toBe(false);
  });
});
