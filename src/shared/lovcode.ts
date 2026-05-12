export type LovcodeAvailability =
  | { status: 'available'; version: string }
  | { status: 'not-installed' };

export type LovcodeSearchResult = { status: 'not-installed' } | { status: 'ok'; taskIds: string[] };

export const LOVCODE_REPO_URL = 'https://github.com/lovstudio/lovcode';
