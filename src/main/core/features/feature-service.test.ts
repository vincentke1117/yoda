import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';

const state = vi.hoisted(() => ({
  db: null as unknown,
  emit: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: state.emit },
}));

describe('FeatureService', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    state.emit.mockReset();
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    createSchema(sqlite);
    seedProjectsAndTasks(sqlite);
    state.db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
    state.db = null;
  });

  it('creates an auditable Feature linked to its source issue', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const feature = await service.create({
      projectId: 'project-1',
      title: 'Feature delivery workflow',
      problem: 'Feature work loses its design and documentation context.',
      sourceIssues: [
        {
          provider: 'github',
          url: 'https://github.com/lovstudio/yoda/issues/1',
          identifier: '#1',
          title: 'Feature delivery workflow',
        },
      ],
    });

    expect(feature).toMatchObject({
      projectId: 'project-1',
      stage: 'problem',
      status: 'active',
      sourceIssues: [{ identifier: '#1' }],
      gate: { canAdvance: true, nextStage: 'design' },
    });
    expect(feature.events.map((event) => event.type)).toEqual(['created']);
    expect(await service.list('project-1')).toEqual([
      expect.objectContaining({
        id: feature.id,
        sourceIssueUrls: ['https://github.com/lovstudio/yoda/issues/1'],
      }),
    ]);

    const duplicate = await service.create({
      projectId: 'project-1',
      title: 'Duplicate attempt',
      problem: 'The same source Issue should not fork the delivery record.',
      sourceIssues: feature.sourceIssues,
    });
    expect(duplicate.id).toBe(feature.id);
    expect(await service.list('project-1')).toHaveLength(1);
  });

  it('enforces artifact approvals before a stage transition', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const created = await service.create({
      projectId: 'project-1',
      title: 'Feature delivery workflow',
      problem: 'The workflow is fragmented.',
    });

    expect((await service.advance('project-1', created.id)).success).toBe(true);
    const blocked = await service.advance('project-1', created.id);
    expect(blocked).toMatchObject({
      success: false,
      error: {
        type: 'gate_blocked',
        gate: {
          canAdvance: false,
          blockers: [
            { code: 'artifact_missing', artifactType: 'product_spec' },
            { code: 'artifact_missing', artifactType: 'acceptance_criteria' },
          ],
        },
      },
    });

    await service.addArtifact('project-1', created.id, {
      type: 'product_spec',
      title: 'Product spec',
      uri: 'docs/product/feature.md',
      status: 'approved',
    });
    const withAcceptanceCriteria = await service.addArtifact('project-1', created.id, {
      type: 'acceptance_criteria',
      title: 'Acceptance criteria',
      uri: 'docs/product/feature.md#ac',
      status: 'draft',
    });
    expect(withAcceptanceCriteria.success).toBe(true);
    if (!withAcceptanceCriteria.success) return;
    const acceptanceCriteria = withAcceptanceCriteria.data.artifacts.find(
      (artifact) => artifact.type === 'acceptance_criteria'
    );
    expect(acceptanceCriteria).toBeDefined();

    await service.updateArtifact('project-1', created.id, acceptanceCriteria!.id, {
      status: 'approved',
    });
    const advanced = await service.advance('project-1', created.id);
    expect(advanced).toMatchObject({ success: true, data: { stage: 'planning' } });
  });

  it('requires linked tasks to reach review before verification', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const feature = await service.create({
      projectId: 'project-1',
      title: 'Feature delivery workflow',
      problem: 'The workflow is fragmented.',
    });
    await service.advance('project-1', feature.id);
    await service.addArtifact('project-1', feature.id, {
      type: 'product_spec',
      title: 'Product spec',
      uri: 'docs/product/feature.md',
      status: 'approved',
    });
    await service.addArtifact('project-1', feature.id, {
      type: 'acceptance_criteria',
      title: 'Acceptance criteria',
      uri: 'docs/product/feature.md#ac',
      status: 'approved',
    });
    await service.advance('project-1', feature.id);
    await service.addArtifact('project-1', feature.id, {
      type: 'technical_plan',
      title: 'Technical plan',
      uri: 'docs/plans/feature.md',
      status: 'approved',
    });
    await service.advance('project-1', feature.id);

    expect(await service.setTaskLinked('project-1', feature.id, 'other-task', true)).toEqual({
      success: false,
      error: { type: 'cross_project_task' },
    });
    await service.setTaskLinked('project-1', feature.id, 'task-1', true);
    expect(await service.advance('project-1', feature.id)).toMatchObject({
      success: false,
      error: { type: 'gate_blocked' },
    });

    sqlite.prepare(`UPDATE tasks SET status = 'review' WHERE id = 'task-1'`).run();
    expect(await service.advance('project-1', feature.id)).toMatchObject({
      success: true,
      data: { stage: 'verification' },
    });
  });

  it('reopens a completed Feature only through a stage retreat', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const feature = await service.create({
      projectId: 'project-1',
      title: 'Completed workflow',
      problem: 'Completion state must stay consistent with the stage.',
    });
    sqlite
      .prepare(`UPDATE features SET stage = 'done', status = 'completed' WHERE id = ?`)
      .run(feature.id);

    expect(await service.update('project-1', feature.id, { status: 'active' })).toMatchObject({
      stage: 'done',
      status: 'completed',
    });
    expect(await service.retreat('project-1', feature.id)).toMatchObject({
      success: true,
      data: { stage: 'release', status: 'active' },
    });
  });
});

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE issues (
      url TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      identifier TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      branch_name TEXT,
      status TEXT,
      assignees TEXT,
      project TEXT,
      updated_at TEXT,
      fetched_at TEXT
    );
    CREATE TABLE features (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      problem TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      non_goals TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'problem',
      status TEXT NOT NULL DEFAULT 'active',
      template_id TEXT NOT NULL DEFAULT 'feature-development-v1',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
    CREATE TABLE feature_tasks (
      feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (feature_id, task_id)
    );
    CREATE TABLE feature_issues (
      feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      issue_url TEXT NOT NULL REFERENCES issues(url) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (feature_id, issue_url)
    );
    CREATE TABLE feature_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      uri TEXT NOT NULL,
      content_hash TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_at TEXT
    );
    CREATE TABLE feature_events (
      id TEXT PRIMARY KEY NOT NULL,
      feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'user',
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedProjectsAndTasks(db: Database.Database): void {
  db.exec(`
    INSERT INTO projects (id) VALUES ('project-1'), ('project-2');
    INSERT INTO tasks (id, project_id, name, status)
    VALUES
      ('task-1', 'project-1', 'Implement feature', 'in_progress'),
      ('other-task', 'project-2', 'Other project task', 'done');
  `);
}
