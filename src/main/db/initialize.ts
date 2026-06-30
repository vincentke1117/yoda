import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import { BUILTIN_AGENT_PRESETS } from '@shared/builtin-agents';
import { sqlite } from './client';
import { runBundledMigrations } from './migrations';

/**
 * Creates the FTS5 full-text search virtual table used by the command palette.
 * This is managed outside the Drizzle migration system because Drizzle cannot
 * generate FTS5 virtual table DDL. The table is version-gated via the `kv`
 * table so it can be safely dropped and recreated when the schema changes.
 */
function ensureSearchIndex(connection: BetterSqlite3.Database): void {
  const SEARCH_INDEX_VERSION = '4';

  const row = connection.prepare(`SELECT value FROM kv WHERE key = 'fts_version'`).get() as
    | { value: string }
    | undefined;

  if (row?.value !== SEARCH_INDEX_VERSION) {
    connection.exec(`DROP TABLE IF EXISTS search_index`);
    connection.exec(`
      CREATE VIRTUAL TABLE search_index USING fts5(
        item_type,
        item_id    UNINDEXED,
        project_id UNINDEXED,
        task_id    UNINDEXED,
        archived   UNINDEXED,
        title,
        keywords,
        tokenize = 'trigram remove_diacritics 1'
      )
    `);
    connection
      .prepare(
        `INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('fts_version', ?, unixepoch())`
      )
      .run(SEARCH_INDEX_VERSION);
  }
}

/**
 * Seeds the built-in Agent presets into the `agents` table. Idempotent: each
 * preset is keyed by its stable `slug`, so we only insert presets that are not
 * already present. This both handles first run and lets users delete a preset
 * without it reappearing on every launch (gated by the kv version below).
 */
function ensureBuiltinAgents(connection: BetterSqlite3.Database): void {
  const BUILTIN_AGENTS_VERSION = '3';

  const row = connection
    .prepare(`SELECT value FROM kv WHERE key = 'builtin_agents_version'`)
    .get() as { value: string } | undefined;
  if (row?.value === BUILTIN_AGENTS_VERSION) return;

  const existsStmt = connection.prepare(`SELECT 1 FROM agents WHERE slug = ? LIMIT 1`);
  const insertStmt = connection.prepare(
    `INSERT INTO agents (id, slug, name, description, icon, system_prompt, enabled_skill_ids, preferred_runtime_provider, model, source)
     VALUES (@id, @slug, @name, @description, @icon, @systemPrompt, '[]', @preferredRuntime, NULL, 'local')`
  );

  const seed = connection.transaction(() => {
    for (const preset of BUILTIN_AGENT_PRESETS) {
      if (existsStmt.get(preset.key)) continue;
      insertStmt.run({
        id: randomUUID(),
        slug: preset.key,
        name: preset.name,
        description: preset.description,
        icon: preset.icon,
        systemPrompt: preset.systemPrompt,
        preferredRuntime: preset.preferredRuntime,
      });
    }
    connection
      .prepare(
        `INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('builtin_agents_version', ?, unixepoch())`
      )
      .run(BUILTIN_AGENTS_VERSION);
  });
  seed();
}

/**
 * Runs all pending migrations against the shared SQLite connection and validates
 * the schema contract. Call this once in main.ts before any db queries run.
 *
 * Throws `DatabaseSchemaMismatchError` when required columns/tables are missing
 * after migration (e.g. the user downgraded from a newer build).
 *
 * Returns the raw better-sqlite3 handle so the caller can close it on shutdown.
 */
export async function initializeDatabase(): Promise<BetterSqlite3.Database> {
  runBundledMigrations(sqlite);
  ensureSearchIndex(sqlite);
  ensureBuiltinAgents(sqlite);
  return sqlite;
}
