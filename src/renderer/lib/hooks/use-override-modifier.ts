import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type RequiredModifiers = {
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

type OverrideState = {
  altLeft: boolean;
  altRight: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

const EMPTY_STATE: OverrideState = {
  altLeft: false,
  altRight: false,
  ctrl: false,
  meta: false,
  shift: false,
};

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift']);

const MODIFIER_ALIASES: Record<string, keyof RequiredModifiers> = {
  alt: 'alt',
  option: 'alt',
  control: 'ctrl',
  ctrl: 'ctrl',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  mod: 'meta',
  shift: 'shift',
};

/**
 * Extracts the modifier set a hotkey requires. A click-override gesture only
 * cares about which modifiers are held, so a non-modifier key in the combo
 * (e.g. the `S` in `Alt+S`) is ignored. `Mod` is treated as `Meta` because the
 * recorder stores the platform-resolved name (`Meta` on macOS, `Control` on
 * Windows), so a raw `Mod` here is only ever the default that we author.
 */
export function requiredModifiers(hotkey: string): RequiredModifiers {
  const required: RequiredModifiers = { alt: false, ctrl: false, meta: false, shift: false };
  for (const part of hotkey.split('+')) {
    const alias = MODIFIER_ALIASES[part.trim().toLowerCase()];
    if (alias) required[alias] = true;
  }
  return required;
}

/**
 * Whether the held modifier state satisfies the override gesture. Every
 * required modifier must be held and no other may be ("on its own", so
 * Cmd+Alt etc. must not trigger it). The `alt` requirement is side-sensitive:
 * the default binding is the LEFT Alt/Option, so only the left key satisfies it
 * — right Option is rarely intended and usually accidental.
 */
export function matchesOverrideModifiers(
  state: OverrideState,
  required: RequiredModifiers
): boolean {
  const altHeld = state.altLeft || state.altRight;
  if (required.alt && !state.altLeft) return false;
  if (required.ctrl && !state.ctrl) return false;
  if (required.meta && !state.meta) return false;
  if (required.shift && !state.shift) return false;
  if (!required.alt && altHeld) return false;
  if (!required.ctrl && state.ctrl) return false;
  if (!required.meta && state.meta) return false;
  if (!required.shift && state.shift) return false;
  return true;
}

/**
 * Tracks whether the configured override modifier(s) are held on their own so an
 * affordance can preview the alternate action it would run, and lets the click
 * handler ask the same question at the moment of the click.
 *
 * `hotkey` is the effective binding (e.g. `'Alt'`, `'Control+Alt'`), or `null`
 * when the override is unassigned. The gesture is "hold the modifier(s) and
 * click", so only the modifier portion of the combo matters. A non-modifier
 * keydown means the modifier is part of a chord (Option+letter in a terminal),
 * which is not the override gesture; its keyup ends the chord so the modifier on
 * its own counts again. Window blur clears the state: focus can leave while the
 * key is down (Alt opens native menus on some platforms) and the matching keyup
 * would never arrive, stranding the preview on.
 */
export function useOverrideModifier(hotkey: string | null): {
  held: boolean;
  isActive: () => boolean;
} {
  const stateRef = useRef<OverrideState>({ ...EMPTY_STATE });
  const chordRef = useRef(false);
  const [held, setHeld] = useState(false);

  const required = useMemo(() => (hotkey ? requiredModifiers(hotkey) : null), [hotkey]);

  useEffect(() => {
    const sync = () =>
      setHeld(
        required ? !chordRef.current && matchesOverrideModifiers(stateRef.current, required) : false
      );

    const applyModifier = (event: KeyboardEvent, down: boolean) => {
      const state = stateRef.current;
      if (event.code === 'AltLeft') state.altLeft = down;
      else if (event.code === 'AltRight') state.altRight = down;
      else if (event.key === 'Control') state.ctrl = down;
      else if (event.key === 'Meta') state.meta = down;
      else if (event.key === 'Shift') state.shift = down;
      else return;
      sync();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(event.key)) {
        chordRef.current = true;
        sync();
        return;
      }
      applyModifier(event, true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!MODIFIER_KEYS.has(event.key)) {
        chordRef.current = false;
        sync();
        return;
      }
      applyModifier(event, false);
    };
    const clear = () => {
      stateRef.current = { ...EMPTY_STATE };
      chordRef.current = false;
      sync();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
    };
  }, [required]);

  const isActive = useCallback(
    () =>
      required ? !chordRef.current && matchesOverrideModifiers(stateRef.current, required) : false,
    [required]
  );

  return { held, isActive };
}
