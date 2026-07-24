import { randomUUID } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Keeps the runnable source inside the dedicated App project as well as in the
 * AI Lab launcher store. The atomic rename prevents a failed write from leaving
 * a truncated app behind.
 */
export async function writeAiLabProjectHtml(projectPath: string, html: string): Promise<void> {
  const targetPath = join(projectPath, 'index.html');
  const temporaryPath = join(projectPath, `.index.html.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, html, 'utf8');
  await rename(temporaryPath, targetPath);
}
