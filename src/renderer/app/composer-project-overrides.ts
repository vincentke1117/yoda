import type { ComposerDefaults } from '@shared/project-settings';

export type ComposerOverrideScope = 'global' | 'project';

/**
 * A single composer setting resolved against the project's `composerDefaults`
 * overrides. `source` is `project` when the project overrides the field and
 * `global` otherwise; `value` is whichever layer is active. `setValue` edits
 * the active layer; `setSource` toggles inherit (clears the override) vs
 * override (seeds the override with the current global value).
 */
export type DualField<T> = {
  source: ComposerOverrideScope;
  value: T;
  canOverride: boolean;
  setValue: (value: T) => void;
  setSource: (source: ComposerOverrideScope) => void;
};

/**
 * Composes a {@link DualField} from a global value/setter pair and the project
 * override for one `composerDefaults` field. Pure — call it inline in render.
 * `setOverride(undefined)` clears the field (back to inherit).
 */
export function dualField<T>(params: {
  override: T | undefined;
  globalValue: T;
  setGlobal: (value: T) => void;
  setOverride: (value: T | undefined) => void;
  hasProject: boolean;
}): DualField<T> {
  const source: ComposerOverrideScope = params.override !== undefined ? 'project' : 'global';
  const value = source === 'project' ? (params.override as T) : params.globalValue;
  return {
    source,
    value,
    canOverride: params.hasProject,
    setValue: (next) => (source === 'project' ? params.setOverride(next) : params.setGlobal(next)),
    setSource: (next) =>
      next === 'project' ? params.setOverride(params.globalValue) : params.setOverride(undefined),
  };
}

/**
 * Returns a `composerDefaults` object with `field` set to `value` (or removed
 * when `value` is undefined), or `undefined` when the result is empty so the
 * caller can drop the whole block from project settings.
 */
export function withComposerDefault<K extends keyof ComposerDefaults>(
  current: ComposerDefaults | undefined,
  field: K,
  value: ComposerDefaults[K] | undefined
): ComposerDefaults | undefined {
  const next: ComposerDefaults = { ...current };
  if (value === undefined) delete next[field];
  else next[field] = value;
  return Object.keys(next).length ? next : undefined;
}
