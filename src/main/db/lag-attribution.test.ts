import { describe, expect, it, vi } from 'vitest';
import { instrumentDatabaseForLagAttribution, sqlStatementLabel } from './lag-attribution';

const recorded: Array<{ label: string; durationMs: number }> = [];
vi.mock('@main/lib/main-thread-lag', () => ({
  recordMainThreadBlockingWork: (label: string, durationMs: number) => {
    recorded.push({ label, durationMs });
  },
}));

describe('sqlStatementLabel', () => {
  it('keeps cardinality at verb plus table', () => {
    expect(sqlStatementLabel('SELECT * FROM tasks WHERE id = ?')).toBe('sqlite:select tasks');
    expect(sqlStatementLabel('insert into  conversations (a) values (?)')).toBe(
      'sqlite:insert conversations'
    );
    expect(sqlStatementLabel('UPDATE "projects" SET name = ?')).toBe('sqlite:update projects');
    expect(sqlStatementLabel('CREATE TABLE migrations (id integer)')).toBe(
      'sqlite:create migrations'
    );
  });

  it('collapses statements with the same shape but different parameters', () => {
    expect(sqlStatementLabel('select id from tasks where id = 1')).toBe(
      sqlStatementLabel('select id from tasks where id = 2')
    );
  });

  it('falls back to the verb when no table is named', () => {
    expect(sqlStatementLabel('PRAGMA journal_mode = WAL')).toBe('sqlite:pragma');
  });
});

type FakeStatement = Record<string, unknown>;
type FakeDatabase = { prepare: (sql: string) => FakeStatement };

describe('instrumentDatabaseForLagAttribution', () => {
  it('times every executing method and leaves results untouched', () => {
    recorded.length = 0;
    const run = vi.fn(() => ({ changes: 1 }));
    const all = vi.fn(() => [{ id: 1 }]);
    const prepare = vi.fn(
      (_sql: string): FakeStatement => ({
        run,
        all,
        columns: 'not-a-function',
      })
    );
    const database: FakeDatabase = { prepare };

    const restore = instrumentDatabaseForLagAttribution(database as never);
    const statement = database.prepare('SELECT * FROM tasks');

    expect((statement.all as () => unknown)()).toEqual([{ id: 1 }]);
    expect((statement.run as () => unknown)()).toEqual({ changes: 1 });
    expect(recorded.map((entry) => entry.label)).toEqual([
      'sqlite:select tasks',
      'sqlite:select tasks',
    ]);
    expect(all).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    // A non-function property must survive untouched.
    expect(statement.columns).toBe('not-a-function');

    restore();
    expect(database.prepare).toBe(prepare);
  });

  it('records the duration even when the statement throws', () => {
    recorded.length = 0;
    const boom = new Error('constraint failed');
    const prepare = vi.fn(
      (_sql: string): FakeStatement => ({
        run: () => {
          throw boom;
        },
      })
    );
    const database: FakeDatabase = { prepare };

    instrumentDatabaseForLagAttribution(database as never);
    const statement = database.prepare('insert into tasks (id) values (?)');

    expect(() => (statement.run as () => unknown)()).toThrow(boom);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.label).toBe('sqlite:insert tasks');
  });
});
