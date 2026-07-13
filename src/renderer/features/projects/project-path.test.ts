import { describe, expect, it } from 'vitest';
import { joinProjectPath } from './project-path';

describe('joinProjectPath', () => {
  it('joins POSIX project paths', () => {
    expect(joinProjectPath('/Users/mark/yoda/', '/docs/feature.md')).toBe(
      '/Users/mark/yoda/docs/feature.md'
    );
  });

  it('preserves Windows separators for remote project paths', () => {
    expect(joinProjectPath('C:\\work\\yoda\\', 'docs/feature.md')).toBe(
      'C:\\work\\yoda\\docs\\feature.md'
    );
  });
});
