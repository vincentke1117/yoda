import type { CatalogSkill } from '@shared/skills/types';

export function filterInstalledSkills(
  skills: readonly CatalogSkill[],
  query: string
): CatalogSkill[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return skills.filter((skill) => {
    if (!skill.installed) return false;
    if (!normalizedQuery) return true;
    return [skill.displayName, skill.id, skill.description, skill.frontmatter.name].some((value) =>
      value?.toLocaleLowerCase().includes(normalizedQuery)
    );
  });
}

export function hasInstalledRuntimeName(skills: readonly CatalogSkill[], skillId: string): boolean {
  return skills.some((skill) => skill.installed && skill.id === skillId);
}
