import type { SkillSelectionInput } from './types';

/**
 * An empty Agent skill profile means "use the runtime defaults". Treating it
 * as an explicit selection would hide every installed skill and emit a runtime
 * override that disables them all.
 */
export function normalizeSkillSelection(
  selection: SkillSelectionInput | null | undefined
): SkillSelectionInput | undefined {
  if (!selection) return undefined;
  if (selection.autoSkillKeys.length === 0 && selection.manualSkillKeys.length === 0) {
    return undefined;
  }
  return selection;
}
