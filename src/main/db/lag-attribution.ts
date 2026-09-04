import type BetterSqlite3 from 'better-sqlite3';
import { recordMainThreadBlockingWork } from '@main/lib/main-thread-lag';

/**
 * Collapse a statement to a low-cardinality label.
 *
 * The attribution table is keyed by label, so the raw SQL would make it grow
 * without bound — every distinct parameter list and generated drizzle query
 * would get its own row. Verb plus table is enough to point at the offender and
 * stays bounded by the schema.
 */
export function sqlStatementLabel(sql: string): string {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  const verb = normalized.split(' ', 1)[0] ?? 'sql';
  const table =
    /\bfrom\s+["'`]?([a-z0-9_]+)/.exec(normalized)?.[1] ??
    /\binto\s+["'`]?([a-z0-9_]+)/.exec(normalized)?.[1] ??
    /\bupdate\s+["'`]?([a-z0-9_]+)/.exec(normalized)?.[1] ??
    /\btable\s+["'`]?([a-z0-9_]+)/.exec(normalized)?.[1];
  return table ? `sqlite:${verb} ${table}` : `sqlite:${verb}`;
}

type StatementMethod = 'run' | 'get' | 'all' | 'iterate' | 'pluck';

const TIMED_METHODS: readonly StatementMethod[] = ['run', 'get', 'all', 'iterate'];

/**
 * Time every statement this database executes.
 *
 * better-sqlite3 is synchronous by design, so each query holds the whole main
 * thread — including the PTY reads and flushes scheduled on it. Queries reached
 * through an RPC handler are already covered by the RPC observer; this exists
 * for the ones that are not, which is every background scheduler, watcher and
 * event handler in the process.
 *
 * Wrapping `prepare` covers drizzle and raw callers alike, since both go
 * through it. Returns a function that restores the original.
 */
export function instrumentDatabaseForLagAttribution(
  database: Pick<BetterSqlite3.Database, 'prepare'>
): () => void {
  // Keep the original property value rather than a bound copy, so restoring
  // gives back the exact function that was there and a second instrument call
  // cannot stack another binding on top.
  const originalPrepare = database.prepare;

  const wrappedPrepare = ((sql: string) => {
    const statement = originalPrepare.call(database, sql) as unknown as Record<string, unknown>;
    const label = sqlStatementLabel(sql);
    for (const method of TIMED_METHODS) {
      const original = statement[method];
      if (typeof original !== 'function') continue;
      statement[method] = function timed(this: unknown, ...args: unknown[]) {
        const startedAt = performance.now();
        try {
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        } finally {
          recordMainThreadBlockingWork(label, performance.now() - startedAt);
        }
      };
    }
    return statement;
  }) as unknown as typeof database.prepare;

  database.prepare = wrappedPrepare;
  return () => {
    database.prepare = originalPrepare;
  };
}
