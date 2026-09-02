import { describe, expect, it } from 'vitest';
import { buildTerminalFileLinkTrimVariants } from '@renderer/lib/pty/terminal-file-link-variants';

describe('buildTerminalFileLinkTrimVariants', () => {
  it('offers shorter readings at every prose boundary in the basename', () => {
    expect(
      buildTerminalFileLinkTrimVariants(
        '/Users/mark/vault/research/我调研了517个活动.md（正文约 1.1'
      )
    ).toEqual([
      '/Users/mark/vault/research/我调研了517个活动.md（正文约 1.1',
      '/Users/mark/vault/research/我调研了517个活动.md（正文约',
      '/Users/mark/vault/research/我调研了517个活动.md',
    ]);
  });

  it('keeps every variant a prefix of the input so the matched cells only shrink', () => {
    const text = '/a/b/report (draft), see notes.md';
    for (const variant of buildTerminalFileLinkTrimVariants(text)) {
      expect(text.startsWith(variant)).toBe(true);
    }
  });

  it('never cuts into the directory part', () => {
    expect(buildTerminalFileLinkTrimVariants('/Users/mark/my docs/plan.md')).toEqual([
      '/Users/mark/my docs/plan.md',
    ]);
  });

  it('drops a line:column suffix from the trimmed readings only', () => {
    expect(buildTerminalFileLinkTrimVariants('/a/b/main.ts:12:3')).toEqual(['/a/b/main.ts:12:3']);
    expect(buildTerminalFileLinkTrimVariants('/a/b/main.ts（注 1.1:12')).toEqual([
      '/a/b/main.ts（注 1.1:12',
      '/a/b/main.ts（注',
      '/a/b/main.ts',
    ]);
  });

  it('leaves trailing-slash directories to the pattern layer', () => {
    expect(buildTerminalFileLinkTrimVariants('/a/b/我的 文档/')).toEqual(['/a/b/我的 文档/']);
  });

  it('caps how many readings it will guess', () => {
    const text = '/a/b/x,y,z,1,2,3,4,5,6,7.md';
    expect(buildTerminalFileLinkTrimVariants(text, 3)).toHaveLength(3);
  });
});
