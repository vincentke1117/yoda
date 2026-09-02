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
 * Labels pre-existing tasks with the paradigm that drove them.
 *
 * Tasks created before `tasks.paradigm_kind` existed carry no paradigm, so it is
 * recovered from the side tables the canvas used to reverse-look-up: a team room
 * means the task was run by a team, a review orchestration means the review loop,
 * and everything else was a single Agent.
 *
 * `paradigm_id` is deliberately left null — the *kind* is recoverable, but which
 * instance ran is not (a room does not record the team it came from). That
 * asymmetry is exactly why the kind is its own column rather than a join.
 *
 * Team wins over review when a task somehow has both: a team may run a review
 * loop internally, so the team is the outer paradigm.
 */
function tableExists(connection: BetterSqlite3.Database, tableName: string): boolean {
  return (
    connection
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(tableName) !== undefined
  );
}

/** @internal exposed for tests */
export function ensureTaskParadigmBackfill(connection: BetterSqlite3.Database): void {
  const BACKFILL_VERSION = '1';

  const row = connection
    .prepare(`SELECT value FROM kv WHERE key = 'task_paradigm_backfill_version'`)
    .get() as { value: string } | undefined;
  if (row?.value === BACKFILL_VERSION) return;
  if (!tableExists(connection, 'tasks')) return;

  // Each source is optional: this runs on the startup path, where throwing over a
  // missing side table would mean the app does not open at all.
  const sources: Array<[kind: string, table: string]> = [
    ['team', 'team_rooms'],
    ['review', 'review_orchestrations'],
  ];

  const backfill = connection.transaction(() => {
    for (const [kind, table] of sources) {
      if (!tableExists(connection, table)) continue;
      connection.exec(
        `UPDATE tasks SET paradigm_kind = '${kind}'
          WHERE paradigm_kind IS NULL AND id IN (SELECT task_id FROM ${table})`
      );
    }
    connection.exec(`UPDATE tasks SET paradigm_kind = 'single' WHERE paradigm_kind IS NULL`);
    connection
      .prepare(
        `INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('task_paradigm_backfill_version', ?, unixepoch())`
      )
      .run(BACKFILL_VERSION);
  });
  backfill();
}

/**
 * Splits legacy multi-session tasks so every task owns exactly one session.
 *
 * A task *is* its session now, but tasks created before that carry up to a dozen
 * — forks, acceptance reviews, "add an agent to this task". Each non-primary
 * session becomes a task of its own: same project, same branch, so it lands in
 * the same refcounted workspace as the task it came out of, and hangs off it as
 * a subtask so the lineage stays visible in the sidebar.
 *
 * The primary session is the initial one when it is still live, else the oldest
 * live one, else the oldest — the session a user opening that task would have
 * been looking at. Fork lineage is preserved by parenting a split task to
 * whichever task ended up owning the session it was forked from.
 *
 * Team-room tasks are skipped: a room legitimately seats one session per
 * teammate, and the conductor routes between them.
 */
/** @internal exposed for tests */
export function ensureOneSessionPerTaskBackfill(connection: BetterSqlite3.Database): void {
  const BACKFILL_VERSION = '1';
  const KEY = 'one_session_per_task_backfill_version';

  const row = connection.prepare(`SELECT value FROM kv WHERE key = '${KEY}'`).get() as
    | { value: string }
    | undefined;
  if (row?.value === BACKFILL_VERSION) return;
  if (!tableExists(connection, 'tasks') || !tableExists(connection, 'conversations')) return;

  const roomTaskIds = new Set<string>(
    tableExists(connection, 'team_rooms')
      ? (
          connection.prepare('SELECT DISTINCT task_id AS taskId FROM team_rooms').all() as Array<{
            taskId: string | null;
          }>
        ).flatMap((entry) => (entry.taskId ? [entry.taskId] : []))
      : []
  );

  const multiSessionTaskIds = (
    connection
      .prepare(`SELECT task_id AS taskId FROM conversations GROUP BY task_id HAVING COUNT(*) > 1`)
      .all() as Array<{ taskId: string }>
  )
    .map((entry) => entry.taskId)
    .filter((taskId) => !roomTaskIds.has(taskId));

  const sessionsOfTask = connection.prepare(
    `SELECT id, title, title_source AS titleSource, created_at AS createdAt,
            updated_at AS updatedAt, last_interacted_at AS lastInteractedAt,
            archived_at AS archivedAt,
            forked_from_conversation_id AS forkedFrom
       FROM conversations
      WHERE task_id = ?
      ORDER BY (archived_at IS NULL) DESC,
               COALESCE(is_initial_conversation, 0) DESC,
               created_at ASC,
               id ASC`
  );
  const taskById = connection.prepare(`SELECT * FROM tasks WHERE id = ?`);
  const insertTask = connection.prepare(
    `INSERT INTO tasks (
       id, project_id, name, status, source_branch, task_branch, archived_at,
       created_at, updated_at, last_interacted_at, status_changed_at,
       is_user_named, workspace_provider, workspace_id, workspace_provider_data,
       sidebar_workspace_id, parent_task_id, facet_id,
       paradigm_id, paradigm_kind, paradigm_params
     ) VALUES (
       @id, @projectId, @name, @status, @sourceBranch, @taskBranch, @archivedAt,
       @createdAt, @updatedAt, @lastInteractedAt, @statusChangedAt,
       @isUserNamed, @workspaceProvider, @workspaceId, @workspaceProviderData,
       @sidebarWorkspaceId, @parentTaskId, @facetId,
       @paradigmId, @paradigmKind, @paradigmParams
     )`
  );
  const moveSession = connection.prepare(`UPDATE conversations SET task_id = ? WHERE id = ?`);
  const reparent = connection.prepare(`UPDATE tasks SET parent_task_id = ? WHERE id = ?`);

  const backfill = connection.transaction(() => {
    /** Session id -> the task that owns it once the split is done. */
    const ownerOfSession = new Map<string, string>();
    /** Split task id -> the session it was forked from, resolved in a second pass. */
    const forkSourceOfTask = new Map<string, string>();

    for (const taskId of multiSessionTaskIds) {
      const source = taskById.get(taskId) as Record<string, unknown> | undefined;
      if (!source) continue;
      const sessions = sessionsOfTask.all(taskId) as Array<{
        id: string;
        title: string | null;
        titleSource: string | null;
        createdAt: string;
        updatedAt: string;
        lastInteractedAt: string | null;
        archivedAt: string | null;
        forkedFrom: string | null;
      }>;
      const [primary, ...split] = sessions;
      if (!primary) continue;
      ownerOfSession.set(primary.id, taskId);

      for (const session of split) {
        const newTaskId = randomUUID();
        insertTask.run({
          id: newTaskId,
          projectId: source.project_id,
          name: session.title?.trim() || String(source.name),
          status: source.status,
          sourceBranch: source.source_branch ?? null,
          taskBranch: source.task_branch ?? null,
          // A session archived on its own stays archived as a task.
          archivedAt: session.archivedAt ?? source.archived_at ?? null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lastInteractedAt: session.lastInteractedAt ?? null,
          statusChangedAt: source.status_changed_at ?? session.createdAt,
          isUserNamed: session.titleSource === 'user' ? 1 : 0,
          workspaceProvider: source.workspace_provider ?? null,
          workspaceId: source.workspace_id ?? null,
          workspaceProviderData: source.workspace_provider_data ?? null,
          sidebarWorkspaceId: source.sidebar_workspace_id ?? null,
          parentTaskId: taskId,
          facetId: source.facet_id ?? null,
          paradigmId: source.paradigm_id ?? null,
          paradigmKind: source.paradigm_kind ?? null,
          paradigmParams: source.paradigm_params ?? null,
        });
        moveSession.run(newTaskId, session.id);
        ownerOfSession.set(session.id, newTaskId);
        if (session.forkedFrom) forkSourceOfTask.set(newTaskId, session.forkedFrom);
      }
    }

    // Fork lineage only resolves once every session has an owner: a fork of a
    // fork must point at the task the parent session ended up in.
    for (const [newTaskId, forkedFromSessionId] of forkSourceOfTask) {
      const parentTaskId = ownerOfSession.get(forkedFromSessionId);
      if (!parentTaskId || parentTaskId === newTaskId) continue;
      reparent.run(parentTaskId, newTaskId);
    }

    connection
      .prepare(
        `INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('${KEY}', ?, unixepoch())`
      )
      .run(BACKFILL_VERSION);
  });
  backfill();
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
  ensureTaskParadigmBackfill(sqlite);
  ensureOneSessionPerTaskBackfill(sqlite);
  return sqlite;
}
