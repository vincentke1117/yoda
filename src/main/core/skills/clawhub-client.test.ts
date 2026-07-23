import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clawHubSourceKey, downloadClawHubSkill, searchClawHubSkills } from './clawhub-client';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true }))
  );
});

describe('ClawHub client', () => {
  it('maps public search results and keeps publishers distinct', async () => {
    const fetchMock = vi.fn(async (_input: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                slug: 'calendar',
                displayName: 'Calendar',
                summary: 'Manage calendars',
                ownerHandle: 'first-publisher',
                owner: { displayName: 'First Publisher' },
                downloads: 42,
              },
              {
                slug: 'calendar',
                displayName: 'Calendar Plus',
                summary: 'Another calendar skill',
                ownerHandle: 'second-publisher',
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      )
    );

    const results = await searchClawHubSkills('calendar', 10, fetchMock);

    expect(results).toEqual([
      expect.objectContaining({
        slug: 'calendar',
        ownerHandle: 'first-publisher',
        ownerDisplayName: 'First Publisher',
        sourceUrl: 'https://clawhub.ai/first-publisher/skills/calendar',
      }),
      expect.objectContaining({
        slug: 'calendar',
        ownerHandle: 'second-publisher',
        sourceUrl: 'https://clawhub.ai/second-publisher/skills/calendar',
      }),
    ]);
    const requestUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestUrl.searchParams.get('q')).toBe('calendar');
    expect(requestUrl.searchParams.get('nonSuspiciousOnly')).toBe('true');
    expect(clawHubSourceKey('first-publisher', 'calendar')).not.toBe(
      clawHubSourceKey('second-publisher', 'calendar')
    );
  });

  it('downloads the exact publisher package and validates the extracted skill root', async () => {
    const targetDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yoda-clawhub-test-'));
    temporaryDirectories.push(targetDir);
    const fetchMock = vi.fn(async (_input: string) =>
      Promise.resolve(
        new Response(new Uint8Array([80, 75, 3, 4]), {
          headers: { 'content-type': 'application/zip' },
        })
      )
    );
    const extractMock = vi.fn(async (_archivePath: string, options: { dir: string }) => {
      await fs.promises.writeFile(
        path.join(options.dir, 'SKILL.md'),
        '---\nname: calendar\ndescription: Calendar skill\n---\n',
        'utf8'
      );
    });

    await downloadClawHubSkill(
      { slug: 'calendar', ownerHandle: 'first-publisher', targetDir },
      { fetchImpl: fetchMock, extractImpl: extractMock }
    );

    const requestUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestUrl.searchParams.get('slug')).toBe('calendar');
    expect(requestUrl.searchParams.get('ownerHandle')).toBe('first-publisher');
    expect(extractMock).toHaveBeenCalledOnce();
    await expect(fs.promises.access(path.join(targetDir, 'SKILL.md'))).resolves.toBeUndefined();
  });
});
