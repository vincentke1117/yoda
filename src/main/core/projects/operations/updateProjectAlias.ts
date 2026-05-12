import { eq } from 'drizzle-orm';
import { MAX_PROJECT_ALIAS_LENGTH } from '@shared/projects';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

export async function updateProjectAlias(projectId: string, alias: string | null): Promise<void> {
  const trimmed = alias?.trim() ?? null;
  const next = trimmed && trimmed.length > 0 ? trimmed : null;
  if (next && next.length > MAX_PROJECT_ALIAS_LENGTH) {
    throw new Error(`Alias exceeds maximum length of ${MAX_PROJECT_ALIAS_LENGTH} characters`);
  }
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!row) throw new Error(`Project ${projectId} not found`);
  await db
    .update(projects)
    .set({ alias: next, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, projectId));
}
