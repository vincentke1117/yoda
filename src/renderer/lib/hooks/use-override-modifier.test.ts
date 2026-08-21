import { describe, expect, it } from 'vitest';
import { matchesOverrideModifiers, requiredModifiers } from './use-override-modifier';

describe('requiredModifiers', () => {
  it('parses a bare Alt as an alt requirement (the default binding)', () => {
    expect(requiredModifiers('Alt')).toEqual({ alt: true, ctrl: false, meta: false, shift: false });
  });

  it('ignores a non-modifier key and keeps the modifiers (hold-to-click gesture)', () => {
    expect(requiredModifiers('Alt+S')).toEqual({
      alt: true,
      ctrl: false,
      meta: false,
      shift: false,
    });
    expect(requiredModifiers('Control+Shift')).toEqual({
      alt: false,
      ctrl: true,
      meta: false,
      shift: true,
    });
  });
});

describe('matchesOverrideModifiers', () => {
  const reqAlt = { alt: true, ctrl: false, meta: false, shift: false };

  it('matches only the LEFT alt by default (right Option does not trigger)', () => {
    expect(
      matchesOverrideModifiers(
        { altLeft: true, altRight: false, ctrl: false, meta: false, shift: false },
        reqAlt
      )
    ).toBe(true);
    expect(
      matchesOverrideModifiers(
        { altLeft: false, altRight: true, ctrl: false, meta: false, shift: false },
        reqAlt
      )
    ).toBe(false);
  });

  it('rejects a chord with an extra modifier (Cmd+Alt is not the override)', () => {
    expect(
      matchesOverrideModifiers(
        { altLeft: true, altRight: false, ctrl: false, meta: true, shift: false },
        reqAlt
      )
    ).toBe(false);
  });

  it('requires every modifier in a multi-modifier combo', () => {
    const reqCtrlAlt = { alt: true, ctrl: true, meta: false, shift: false };
    expect(
      matchesOverrideModifiers(
        { altLeft: true, altRight: false, ctrl: true, meta: false, shift: false },
        reqCtrlAlt
      )
    ).toBe(true);
    expect(
      matchesOverrideModifiers(
        { altLeft: true, altRight: false, ctrl: false, meta: false, shift: false },
        reqCtrlAlt
      )
    ).toBe(false);
  });
});
