import type { KeyboardEvent } from 'react';

/**
 * True when a keydown fired while an IME composition is in progress — e.g.
 * confirming a pinyin candidate with Enter. Guard Enter-to-submit handlers
 * with this so confirming a candidate doesn't submit the input. `isComposing`
 * covers all IMEs; keyCode 229 is a WebKit edge case.
 */
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}
