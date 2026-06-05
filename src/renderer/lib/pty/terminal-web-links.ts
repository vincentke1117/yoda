import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { getWindowedLineStrings, mapStringRangeToViewportRange } from './terminal-file-links';
import { isTerminalLinkCellInRange, type TerminalLinkCellPosition } from './terminal-link-target';

// Mirrors @xterm/addon-web-links' URL regex (RFC-style).
const URL_REGEX = /(?:https?|HTTPS?|ftp|FTP|file|FILE):\/\/[^\s"'<>`]+[^\s"'<>`.,;:!?)\]}]/g;

export interface TerminalWebLinkOptions {
  onOpen: (url: string) => void;
}

export interface TerminalWebLinkMatch {
  range: ILink['range'];
  url: string;
}

export function getTerminalWebLinkMatches(
  terminal: Terminal,
  bufferLineNumber: number
): TerminalWebLinkMatch[] {
  const [lines, startLineIndex] = getWindowedLineStrings(bufferLineNumber - 1, terminal);
  const line = lines.join('');
  if (!line) return [];

  const matches: TerminalWebLinkMatch[] = [];
  URL_REGEX.lastIndex = 0;
  for (const match of line.matchAll(URL_REGEX)) {
    const url = match[0];
    if (!url) continue;
    const range = mapStringRangeToViewportRange(
      terminal,
      startLineIndex,
      match.index ?? 0,
      url.length
    );
    if (!range) continue;

    matches.push({ range, url });
  }

  return matches;
}

export function getTerminalWebLinkAtCell(
  terminal: Terminal,
  bufferLineNumber: number,
  position: TerminalLinkCellPosition
): TerminalWebLinkMatch | null {
  return (
    getTerminalWebLinkMatches(terminal, bufferLineNumber).find((match) =>
      isTerminalLinkCellInRange(match.range, position)
    ) ?? null
  );
}

export function registerTerminalWebLinkProvider(
  terminal: Terminal,
  getOptions: () => TerminalWebLinkOptions | null
): { dispose: () => void } {
  return terminal.registerLinkProvider(new TerminalWebLinkProvider(terminal, getOptions));
}

class TerminalWebLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly getOptions: () => TerminalWebLinkOptions | null
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const options = this.getOptions();
    if (!options) {
      callback(undefined);
      return;
    }

    const links = getTerminalWebLinkMatches(this.terminal, bufferLineNumber).map(
      (match): ILink => ({
        range: match.range,
        text: match.url,
        decorations: {
          pointerCursor: true,
          underline: true,
        },
        activate: (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          this.getOptions()?.onOpen(match.url);
        },
      })
    );

    callback(links.length > 0 ? links : undefined);
  }
}
