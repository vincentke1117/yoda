import { describe, expect, it } from 'vitest';
import {
  extractTerminalFileLinkCandidates,
  resolveTerminalFileLinkTarget,
} from '@renderer/lib/pty/terminal-file-links';
import { isTerminalLinkCellInRange } from '@renderer/lib/pty/terminal-link-target';

describe('terminal file links', () => {
  it('extracts generated artifact paths after Chinese labels', () => {
    const line = '  - 可编辑 HTML：poster/product-matrix/index.html';

    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      {
        text: 'poster/product-matrix/index.html',
        index: line.indexOf('poster/product-matrix/index.html'),
      },
    ]);
  });

  it('extracts paths with line and column suffixes', () => {
    expect(extractTerminalFileLinkCandidates('open src/main/index.ts:12:3 now')).toEqual([
      {
        text: 'src/main/index.ts:12:3',
        index: 'open '.length,
      },
    ]);
  });

  it('extracts source paths with mention prefixes and component breadcrumbs', () => {
    const line =
      '@src/renderer/lib/pty/pane-sizing-context.tsx:195:7(ResizablePanelGroup>ResizablePanel>div>div>div>div>div)';

    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      {
        text: '@src/renderer/lib/pty/pane-sizing-context.tsx:195:7',
        index: 0,
      },
    ]);
  });

  it('extracts ~/ paths terminated by a CJK fullwidth bracket', () => {
    const line =
      '主报告：~/Documents/cli-agent-runtime-research-20260605/手工川-codex-claude-yoda-runtime-2026-06-05-v0.1.md（1036 行）';
    const expected =
      '~/Documents/cli-agent-runtime-research-20260605/手工川-codex-claude-yoda-runtime-2026-06-05-v0.1.md';
    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: expected, index: line.indexOf(expected) },
    ]);
  });

  it('terminates absolute paths at CJK sentence-final punctuation', () => {
    expect(extractTerminalFileLinkCandidates('路径：/Users/foo/bar.txt。')).toEqual([
      { text: '/Users/foo/bar.txt', index: '路径：'.length },
    ]);
  });

  it('drops a trailing sentence period after the extension', () => {
    const line = 'output/手工川-会话实时摘要机制-2026-06-09-v0.1.md.';
    const expected = 'output/手工川-会话实时摘要机制-2026-06-09-v0.1.md';
    expect(extractTerminalFileLinkCandidates(line)).toEqual([{ text: expected, index: 0 }]);
  });

  it('terminates paths at an ASCII paren so trailing prose is not swallowed', () => {
    const line =
      'output/手工川-codex-vs-cc-问卷工具-2026-06-09-v0.1.md(含逐条 file:line 证据 + 置信度表)';
    const expected = 'output/手工川-codex-vs-cc-问卷工具-2026-06-09-v0.1.md';
    expect(extractTerminalFileLinkCandidates(line)).toEqual([{ text: expected, index: 0 }]);
  });

  it('strips ASCII parens wrapping a path', () => {
    const line = '见 (src/foo.ts) 文件';
    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: 'src/foo.ts', index: line.indexOf('src/foo.ts') },
    ]);
  });

  it('keeps interior dots in multi-part extensions', () => {
    expect(extractTerminalFileLinkCandidates('看 output/foo.md.bak 后面')).toEqual([
      { text: 'output/foo.md.bak', index: '看 '.length },
    ]);
  });

  it('extracts trailing-slash directory paths', () => {
    const line = '产物目录：output/slide-deck/moments-chronicle/';
    const expected = 'output/slide-deck/moments-chronicle/';
    expect(extractTerminalFileLinkCandidates(line)).toEqual([
      { text: expected, index: line.indexOf(expected) },
    ]);
  });

  it('extracts a single-segment directory after a command', () => {
    expect(extractTerminalFileLinkCandidates('cd src/ && ls')).toEqual([
      { text: 'src/', index: 'cd '.length },
    ]);
  });

  it('does not match a multi-segment path without an extension or trailing slash', () => {
    expect(extractTerminalFileLinkCandidates('see src/main here')).toEqual([]);
  });

  it('resolves a workspace-relative directory to its folder (no filePath)', () => {
    expect(
      resolveTerminalFileLinkTarget('output/slide-deck/moments-chronicle/', '/Users/mark/project')
    ).toEqual({
      originalText: 'output/slide-deck/moments-chronicle/',
      isDirectory: true,
      absolutePath: '/Users/mark/project/output/slide-deck/moments-chronicle',
    });
  });

  it('resolves an absolute directory outside the workspace', () => {
    expect(resolveTerminalFileLinkTarget('/tmp/outside/', '/Users/mark/project')).toEqual({
      originalText: '/tmp/outside/',
      isDirectory: true,
      absolutePath: '/tmp/outside',
    });
  });

  it('normalizes workspace-relative paths', () => {
    expect(resolveTerminalFileLinkTarget('./poster/../poster/index.html')).toEqual({
      originalText: './poster/../poster/index.html',
      filePath: 'poster/index.html',
      absolutePath: undefined,
      line: undefined,
      column: undefined,
    });
  });

  it('converts absolute paths under the workspace root', () => {
    expect(
      resolveTerminalFileLinkTarget(
        '/Users/mark/project/poster/product-matrix/index.html:5',
        '/Users/mark/project'
      )
    ).toEqual({
      originalText: '/Users/mark/project/poster/product-matrix/index.html:5',
      filePath: 'poster/product-matrix/index.html',
      absolutePath: '/Users/mark/project/poster/product-matrix/index.html',
      line: 5,
      column: undefined,
    });
  });

  it('strips mention prefixes when resolving source links', () => {
    expect(resolveTerminalFileLinkTarget('@src/main/index.ts:12:3')).toEqual({
      originalText: '@src/main/index.ts:12:3',
      filePath: 'src/main/index.ts',
      absolutePath: undefined,
      line: 12,
      column: 3,
    });
  });

  it('preserves absolute paths outside the workspace root as absolutePath only', () => {
    expect(resolveTerminalFileLinkTarget('/tmp/outside/file.html', '/Users/mark/project')).toEqual({
      originalText: '/tmp/outside/file.html',
      absolutePath: '/tmp/outside/file.html',
      line: undefined,
      column: undefined,
    });
  });

  it('expands ~/ paths against the home dir', () => {
    expect(resolveTerminalFileLinkTarget('~/Documents/foo.md:3', undefined, '/Users/mark')).toEqual(
      {
        originalText: '~/Documents/foo.md:3',
        absolutePath: '/Users/mark/Documents/foo.md',
        line: 3,
        column: undefined,
      }
    );
  });

  it('returns null for ~/ paths when no home dir is provided', () => {
    expect(resolveTerminalFileLinkTarget('~/Documents/foo.md')).toBeNull();
  });
});

describe('terminal link target ranges', () => {
  it('matches cells inside a single-line link range', () => {
    const range = { start: { x: 4, y: 2 }, end: { x: 12, y: 2 } };

    expect(isTerminalLinkCellInRange(range, { x: 4, y: 2 })).toBe(true);
    expect(isTerminalLinkCellInRange(range, { x: 12, y: 2 })).toBe(true);
    expect(isTerminalLinkCellInRange(range, { x: 3, y: 2 })).toBe(false);
    expect(isTerminalLinkCellInRange(range, { x: 13, y: 2 })).toBe(false);
  });

  it('matches cells inside a wrapped multi-line link range', () => {
    const range = { start: { x: 10, y: 2 }, end: { x: 6, y: 4 } };

    expect(isTerminalLinkCellInRange(range, { x: 9, y: 2 })).toBe(false);
    expect(isTerminalLinkCellInRange(range, { x: 10, y: 2 })).toBe(true);
    expect(isTerminalLinkCellInRange(range, { x: 1, y: 3 })).toBe(true);
    expect(isTerminalLinkCellInRange(range, { x: 6, y: 4 })).toBe(true);
    expect(isTerminalLinkCellInRange(range, { x: 7, y: 4 })).toBe(false);
  });
});
