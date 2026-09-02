import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureOneSessionPerTaskBackfill } from './initialize';

// `initialize` reaches the app-wide connection at import time, which resolves a
// userData path through Electron. The backfill takes its connection as an
// argument, so the shared one is never touched here.
vi.mock('./client', () => ({ sqlite: {} }));

/**
 * The split is what makes "a task is its session" true of existing databases,
 * and it runs on the startup path — so which session stays put, where the rest
 * land, and what a second launch does are all load-bearing.
 */
describe('one session per task backfill', () => {
  let sqlite: Database.Database;

  const insertTask = (id: string, overrides: Record<string, unknown> = {}) => {
    const row = {
      id,
      project_id: 'proj-1',
      name: `task ${id}`,
      status: 'in_progress',
      source_branch: '{"type":"local","branch":"main"}',
      task_branch: 'yoda/abc',
      archived_at: null,
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
      last_interacted_at: null,
      status_changed_at: '2026-01-01 00:00:00',
      is_user_named: 0,
      workspace_provider: null,
      workspace_id: 'local:proj-1:branch:yoda/abc',
      workspace_provider_data: null,
      sidebar_workspace_id: null,
      parent_task_id: null,
      facet_id: 'facet-1',
      paradigm_id: 'builtin:single',
      paradigm_kind: 'single',
      paradigm_params: null,
      ...overrides,
    };
    const keys = Object.keys(row);
    sqlite
      .prepare(
        `INSERT INTO tasks (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`
      )
      .run(row);
  };

  const insertSession = (id: string, taskId: string, overrides: Record<string, unknown> = {}) => {
    const row = {
      id,
      project_id: 'proj-1',
      task_id: taskId,
      title: `session ${id}`,
      title_source: null,
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
      last_interacted_at: null,
      archived_at: null,
      is_initial_conversation: null,
      forked_from_conversation_id: null,
      ...overrides,
    };
    const keys = Object.keys(row);
    sqlite
      .prepare(
        `INSERT INTO conversations (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`
      )
      .run(row);
  };

  const ownerOf = (sessionId: string) =>
    (
      sqlite.prepare('SELECT task_id AS taskId FROM conversations WHERE id = ?').get(sessionId) as {
        taskId: string;
      }
    ).taskId;

  const taskOf = (taskId: string) =>
    sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown>;

  const sessionCounts = () =>
    Object.fromEntries(
      (
        sqlite
          .prepare('SELECT task_id AS taskId, COUNT(*) AS n FROM conversations GROUP BY task_id')
          .all() as Array<{ taskId: string; n: number }>
      ).map((entry) => [entry.taskId, entry.n])
    );

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        source_branch TEXT,
        task_branch TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_interacted_at TEXT,
        status_changed_at TEXT NOT NULL,
        is_user_named INTEGER NOT NULL DEFAULT 0,
        workspace_provider TEXT,
        workspace_id TEXT,
        workspace_provider_data TEXT,
        sidebar_workspace_id TEXT,
        parent_task_id TEXT,
        facet_id TEXT,
        paradigm_id TEXT,
        paradigm_kind TEXT,
        paradigm_params TEXT
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        title TEXT,
        title_source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_interacted_at TEXT,
        archived_at TEXT,
        is_initial_conversation INTEGER,
        forked_from_conversation_id TEXT
      );
      CREATE TABLE team_rooms (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
      CREATE TABLE kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  afterEach(() => sqlite.close());

  it('keeps the initial session on the task and moves the rest to subtasks of it', () => {
    insertTask('task-1');
    insertSession('sess-initial', 'task-1', {
      is_initial_conversation: 1,
      created_at: '2026-01-02 00:00:00',
    });
    insertSession('sess-second', 'task-1', { title: 'Acceptance review' });

    ensureOneSessionPerTaskBackfill(sqlite);

    expect(ownerOf('sess-initial')).toBe('task-1');
    const splitTaskId = ownerOf('sess-second');
    expect(splitTaskId).not.toBe('task-1');
    const split = taskOf(splitTaskId);
    expect(split.parent_task_id).toBe('task-1');
    expect(split.name).toBe('Acceptance review');
    // Same branch and workspace: the split task shares the worktree it was
    // already working in, rather than provisioning one of its own.
    expect(split.task_branch).toBe('yoda/abc');
    expect(split.workspace_id).toBe('local:proj-1:branch:yoda/abc');
    expect(split.facet_id).toBe('facet-1');
    expect(split.paradigm_kind).toBe('single');
    // No session is created or lost, only re-homed.
    expect(sessionCounts()).toEqual({ 'task-1': 1, [splitTaskId]: 1 });
  });

  it('leaves single-session tasks completely alone', () => {
    insertTask('task-1');
    insertSession('sess-only', 'task-1');

    ensureOneSessionPerTaskBackfill(sqlite);

    expect(sessionCounts()).toEqual({ 'task-1': 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 1 });
  });

  it('parents a fork at the task that ended up owning the session it forked from', () => {
    insertTask('task-1');
    insertSession('sess-initial', 'task-1', { is_initial_conversation: 1 });
    insertSession('sess-fork', 'task-1', {
      forked_from_conversation_id: 'sess-initial',
      created_at: '2026-01-02 00:00:00',
    });
    insertSession('sess-fork-of-fork', 'task-1', {
      forked_from_conversation_id: 'sess-fork',
      created_at: '2026-01-03 00:00:00',
    });

    ensureOneSessionPerTaskBackfill(sqlite);

    const forkTaskId = ownerOf('sess-fork');
    const deepForkTaskId = ownerOf('sess-fork-of-fork');
    expect(taskOf(forkTaskId).parent_task_id).toBe('task-1');
    expect(taskOf(deepForkTaskId).parent_task_id).toBe(forkTaskId);
  });

  it('promotes a live session over an archived initial one, and keeps archived sessions archived', () => {
    insertTask('task-1');
    insertSession('sess-initial-archived', 'task-1', {
      is_initial_conversation: 1,
      archived_at: '2026-02-01 00:00:00',
    });
    insertSession('sess-live', 'task-1', { created_at: '2026-01-05 00:00:00' });

    ensureOneSessionPerTaskBackfill(sqlite);

    expect(ownerOf('sess-live')).toBe('task-1');
    const archivedTaskId = ownerOf('sess-initial-archived');
    expect(taskOf(archivedTaskId).archived_at).toBe('2026-02-01 00:00:00');
  });

  it('carries a user-set session title over as a name auto-naming will not rewrite', () => {
    insertTask('task-1');
    insertSession('sess-initial', 'task-1', { is_initial_conversation: 1 });
    insertSession('sess-named', 'task-1', {
      title: 'Named by hand',
      title_source: 'user',
      created_at: '2026-01-02 00:00:00',
    });

    ensureOneSessionPerTaskBackfill(sqlite);

    expect(taskOf(ownerOf('sess-named')).is_user_named).toBe(1);
  });

  it('skips team-room tasks, which legitimately seat one session per teammate', () => {
    insertTask('room-task');
    insertSession('sess-a', 'room-task');
    insertSession('sess-b', 'room-task');
    sqlite.prepare('INSERT INTO team_rooms (id, task_id) VALUES (?, ?)').run('room-1', 'room-task');

    ensureOneSessionPerTaskBackfill(sqlite);

    expect(sessionCounts()).toEqual({ 'room-task': 2 });
  });

  it('does not re-run, so sessions added afterwards are left where they are', () => {
    insertTask('task-1');
    insertSession('sess-initial', 'task-1', { is_initial_conversation: 1 });
    insertSession('sess-second', 'task-1', { created_at: '2026-01-02 00:00:00' });
    ensureOneSessionPerTaskBackfill(sqlite);
    const taskCount = sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get();

    ensureOneSessionPerTaskBackfill(sqlite);

    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual(taskCount);
  });
});
