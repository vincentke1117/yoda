import { eq } from 'drizzle-orm';
import type { TaskNamingSnapshot } from '@shared/task-naming';
import type { CreateTaskParams } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { generateTaskNames } from '@main/core/tasks/name-generation/task-naming-service';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { fromStoredBranch } from '../stored-branch';

export type SuggestedTaskName = {
  name: string | null;
  message?: string;
  snapshot: TaskNamingSnapshot;
};

export async function suggestTaskName(
  projectId: string,
  taskId: string
): Promise<SuggestedTaskName> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) throw new Error(`Task not found: ${taskId}`);

  const project = projectManager.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const parsedSetupParams = parseSetupParams(row.setupData);
  const params = parsedSetupParams ?? {
    id: taskId,
    projectId,
    name: row.name,
    sourceBranch: row.sourceBranch
      ? fromStoredBranch(row.sourceBranch)
      : { type: 'local' as const, branch: row.taskBranch ?? 'main' },
    strategy: row.taskBranch
      ? { kind: 'checkout-existing' as const }
      : { kind: 'no-worktree' as const },
  };

  const naming = await generateTaskNames({
    taskId,
    projectId,
    project,
    params,
    includeBranchName: false,
    target: 'task',
  });

  if (!naming.success || !naming.taskName) {
    return {
      name: null,
      message: naming.success ? undefined : naming.message,
      snapshot: naming.snapshot,
    };
  }

  return { name: naming.taskName, snapshot: naming.snapshot };
}

function parseSetupParams(value: string | null): CreateTaskParams | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { params?: CreateTaskParams };
    return parsed.params ?? null;
  } catch {
    return null;
  }
}
