import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { and, eq, inArray } from 'drizzle-orm';
import type { LovcodeAvailability, LovcodeSearchResult } from '@shared/lovcode';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';

const execFileAsync = promisify(execFile);
const LOVCODE_BIN = 'lovcode';
const SEARCH_TIMEOUT_MS = 10_000;
const VERSION_TIMEOUT_MS = 3_000;

type LovcodeSearchRow = {
  source?: string;
  session_id?: string;
  sessionId?: string;
};

class LovcodeService {
  private cachedAvailability: LovcodeAvailability | null = null;

  async checkAvailability(force = false): Promise<LovcodeAvailability> {
    if (!force && this.cachedAvailability) return this.cachedAvailability;
    try {
      const { stdout } = await execFileAsync(LOVCODE_BIN, ['--version'], {
        timeout: VERSION_TIMEOUT_MS,
        encoding: 'utf8',
      });
      this.cachedAvailability = { status: 'available', version: stdout.trim() };
    } catch (err) {
      log.debug('LovcodeService: lovcode binary not available', { error: String(err) });
      this.cachedAvailability = { status: 'not-installed' };
    }
    return this.cachedAvailability;
  }

  async search(
    projectId: string,
    projectPath: string,
    query: string
  ): Promise<LovcodeSearchResult> {
    const availability = await this.checkAvailability();
    if (availability.status !== 'available') return { status: 'not-installed' };

    const trimmed = query.trim();
    if (!trimmed) return { status: 'ok', taskIds: [] };

    let sessionIds: string[];
    try {
      const { stdout } = await execFileAsync(
        LOVCODE_BIN,
        ['search', trimmed, '--project', projectPath, '--source', 'claude-code', '--json'],
        { timeout: SEARCH_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      );
      sessionIds = parseSessionIds(stdout);
    } catch (err) {
      log.warn('LovcodeService: search failed', { query: trimmed, error: String(err) });
      return { status: 'ok', taskIds: [] };
    }

    if (sessionIds.length === 0) return { status: 'ok', taskIds: [] };

    const rows = await db
      .select({ taskId: conversations.taskId })
      .from(conversations)
      .where(and(eq(conversations.projectId, projectId), inArray(conversations.id, sessionIds)));

    const taskIds = Array.from(new Set(rows.map((r) => r.taskId)));
    return { status: 'ok', taskIds };
  }
}

function parseSessionIds(stdout: string): string[] {
  const ids = new Set<string>();
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  const pushFrom = (row: unknown) => {
    if (!row || typeof row !== 'object') return;
    const r = row as LovcodeSearchRow;
    const id = r.session_id ?? r.sessionId;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  };

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) parsed.forEach(pushFrom);
    } catch (err) {
      log.debug('LovcodeService: JSON array parse failed', { error: String(err) });
    }
    return Array.from(ids);
  }

  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    try {
      pushFrom(JSON.parse(l));
    } catch {
      // Skip non-JSON lines (e.g. log noise from older lovcode builds)
    }
  }
  return Array.from(ids);
}

export const lovcodeService = new LovcodeService();
