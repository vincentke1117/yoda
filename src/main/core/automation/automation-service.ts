import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import {
  automationCreateInputSchema,
  automationUpdateInputSchema,
  type Automation,
  type AutomationCreateInput,
  type AutomationUpdateInput,
} from '@shared/automation';
import { automationsUpdatedChannel } from '@shared/events/appEvents';
import { isValidRuntimeId } from '@shared/runtime-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { automations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

type AutomationRow = typeof automations.$inferSelect;

function toAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    title: row.title,
    workspaceName: row.workspaceName,
    prompt: row.prompt,
    runtime: isValidRuntimeId(row.runtime) ? row.runtime : 'codex',
    scheduleLabel: row.scheduleLabel,
    status: row.status === 'paused' ? 'paused' : 'active',
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Automations are stored in the `automations` table. This service is the single
 * source of truth; the renderer reaches it only via RPC. Legacy entries that
 * lived in `app_settings['automations']` are migrated into the table once, on
 * first read.
 */
export class AutomationService {
  private migration: Promise<void> | null = null;

  /** Moves any legacy app_settings entries into the table exactly once. */
  private async ensureMigrated(): Promise<void> {
    this.migration ??= (async () => {
      const legacy = await appSettingsService.get('automations');
      const items = legacy?.items ?? [];
      if (items.length === 0) return;

      const existing = await db.select({ id: automations.id }).from(automations).limit(1);
      if (existing.length === 0) {
        await db.insert(automations).values(
          items.map((item, index) => ({
            id: item.id || randomUUID(),
            title: item.title,
            workspaceName: item.workspaceName,
            prompt: item.prompt,
            runtime: item.runtime,
            scheduleLabel: item.scheduleLabel ?? '',
            status: item.status === 'paused' ? 'paused' : 'active',
            sortOrder: index,
            lastRunAt: item.lastRunAt ?? null,
            createdAt: item.createdAt ?? new Date().toISOString(),
            updatedAt: item.updatedAt ?? new Date().toISOString(),
          }))
        );
        log.info('[automation] migrated legacy entries from settings', { count: items.length });
      }
      // Clear the legacy blob so we never re-migrate.
      await appSettingsService.update('automations', { items: [] });
    })().catch((error) => {
      log.warn('[automation] migration failed', { error: String(error) });
    });
    return this.migration;
  }

  async list(): Promise<Automation[]> {
    await this.ensureMigrated();
    const rows = await db
      .select()
      .from(automations)
      .orderBy(asc(automations.sortOrder), asc(automations.createdAt));
    return rows.map(toAutomation);
  }

  async create(input: AutomationCreateInput): Promise<Automation> {
    await this.ensureMigrated();
    const parsed = automationCreateInputSchema.parse(input);
    const now = new Date().toISOString();
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(min(${automations.sortOrder}), 0) - 1` })
      .from(automations);
    const row = {
      id: randomUUID(),
      title: parsed.title,
      workspaceName: parsed.workspaceName,
      prompt: parsed.prompt,
      runtime: parsed.runtime,
      scheduleLabel: parsed.scheduleLabel,
      status: parsed.status,
      sortOrder: next ?? 0,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(automations).values(row);
    events.emit(automationsUpdatedChannel, undefined);
    return toAutomation(row);
  }

  async update(id: string, patch: AutomationUpdateInput): Promise<Automation | null> {
    await this.ensureMigrated();
    const parsed = automationUpdateInputSchema.parse(patch);
    if (Object.keys(parsed).length > 0) {
      await db.update(automations).set(parsed).where(eq(automations.id, id));
    }
    events.emit(automationsUpdatedChannel, undefined);
    const [row] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
    return row ? toAutomation(row) : null;
  }

  async remove(id: string): Promise<void> {
    await this.ensureMigrated();
    await db.delete(automations).where(eq(automations.id, id));
    events.emit(automationsUpdatedChannel, undefined);
  }
}

export const automationService = new AutomationService();
