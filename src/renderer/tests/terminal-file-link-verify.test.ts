import { beforeEach, describe, expect, it, vi } from 'vitest';

const probePaths = vi.fn();
vi.mock('@renderer/lib/ipc', () => ({ rpc: { fs: { probePaths } } }));

const {
  applyCachedTerminalFileLinkVerification,
  clearTerminalFileLinkVerificationCache,
  verifyTerminalFileLinkMatches,
} = await import('@renderer/lib/pty/terminal-file-link-verify');
const { getTerminalFileLinkMatches } = await import('@renderer/lib/pty/terminal-file-links');
const { makeTerminal } = await import('./helpers/mock-terminal');

// A filename with an internal space is where the pattern layer genuinely runs
// out of information: `研究 笔记.md 正文约 1.1 万字.md` is indistinguishable from
// a long multi-word filename, so the regex has to read to the last extension.
const REAL_FILE = '/Users/mark/lovstudio/vault/手工川AI创造营/研究 笔记.md';
const TRAILING_PROSE = ' 正文约 1.1 万字.md';
const LINE = `已写入 ${REAL_FILE}${TRAILING_PROSE}`;

function scan(line = LINE) {
  return getTerminalFileLinkMatches(makeTerminal([line]), 1, {
    workspaceRoot: '/Users/mark/lovstudio',
    onOpen: (): void => undefined,
  });
}

/** Answer the probe as a filesystem where only `existing` is present. */
function diskContaining(...existing: string[]) {
  return async (paths: string[]) => ({
    success: true as const,
    data: { kinds: paths.map((path) => (existing.includes(path) ? ('file' as const) : null)) },
  });
}

beforeEach(() => {
  clearTerminalFileLinkVerificationCache();
  probePaths.mockReset();
});

describe('verifyTerminalFileLinkMatches', () => {
  it('narrows an over-matched path onto the reading that exists on disk', async () => {
    const matches = scan();
    expect(matches[0].text).toBe(`${REAL_FILE}${TRAILING_PROSE}`);

    probePaths.mockImplementation(diskContaining(REAL_FILE));
    const [verified] = await verifyTerminalFileLinkMatches(matches, {});

    expect(verified.text).toBe(REAL_FILE);
    expect(verified.target.absolutePath).toBe(REAL_FILE);
    // The link start is unchanged and the highlight only got shorter.
    expect(verified.range.start).toEqual(matches[0].range.start);
    expect(verified.range.end.x).toBeLessThan(matches[0].range.end.x);
  });

  it('prefers the longest existing reading', async () => {
    // A file really named `研究 笔记.md 正文约` would shadow the shorter reading.
    const longer = `${REAL_FILE} 正文约`;
    const matches = scan();
    probePaths.mockImplementation(diskContaining(REAL_FILE, longer));

    const [verified] = await verifyTerminalFileLinkMatches(matches, {});
    expect(verified.text).toBe(longer);
  });

  it('leaves a path the pattern layer already ended correctly alone', async () => {
    // The bug report: full-width brackets are excluded from the spaced form, so
    // the prose never becomes part of the candidate in the first place.
    const bracketed = '/Users/mark/lovstudio/vault/research/我调研了517个活动.md';
    const matches = scan(`已写入 ${bracketed}（正文约 1.1 万字）`);

    expect(matches[0].text).toBe(bracketed);
    expect(probePaths).not.toHaveBeenCalled();
  });

  it('keeps the pattern verdict when nothing on disk matches', async () => {
    const matches = scan();
    probePaths.mockImplementation(diskContaining());

    const [verified] = await verifyTerminalFileLinkMatches(matches, {});
    expect(verified.text).toBe(matches[0].text);
  });

  it('keeps the pattern verdict when the probe fails', async () => {
    const matches = scan();
    probePaths.mockResolvedValue({ success: false, error: 'boom' });

    const [verified] = await verifyTerminalFileLinkMatches(matches, {});
    expect(verified.text).toBe(matches[0].text);
  });

  it('does not touch IPC when a candidate has only one plausible reading', async () => {
    const matches = scan('已写入 /Users/mark/lovstudio/notes/plan.md 完成');
    const [verified] = await verifyTerminalFileLinkMatches(matches, {});

    expect(probePaths).not.toHaveBeenCalled();
    expect(verified.text).toBe('/Users/mark/lovstudio/notes/plan.md');
  });

  it('probes each path once and reuses the verdict across hovers', async () => {
    probePaths.mockImplementation(diskContaining(REAL_FILE));

    await verifyTerminalFileLinkMatches(scan(), {});
    const callsAfterFirst = probePaths.mock.calls.length;
    await verifyTerminalFileLinkMatches(scan(), {});

    expect(callsAfterFirst).toBe(1);
    expect(probePaths).toHaveBeenCalledTimes(1);
  });

  it('scopes cached verdicts to the connection they were probed on', async () => {
    probePaths.mockImplementation(diskContaining(REAL_FILE));
    await verifyTerminalFileLinkMatches(scan(), {});
    await verifyTerminalFileLinkMatches(scan(), { sshConnectionId: 'remote-1' });

    expect(probePaths).toHaveBeenCalledTimes(2);
    expect(probePaths.mock.calls[1][1]).toBe('remote-1');
  });
});

describe('applyCachedTerminalFileLinkVerification', () => {
  it('returns the pattern match while the verdict is still unknown', () => {
    const [match] = scan();
    expect(applyCachedTerminalFileLinkVerification(match, {}).text).toBe(match.text);
    expect(probePaths).not.toHaveBeenCalled();
  });

  it('reuses a warm verdict so a right-click matches the underlined link', async () => {
    probePaths.mockImplementation(diskContaining(REAL_FILE));
    await verifyTerminalFileLinkMatches(scan(), {});

    const [match] = scan();
    expect(applyCachedTerminalFileLinkVerification(match, {}).text).toBe(REAL_FILE);
  });
});
