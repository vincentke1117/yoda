import { applyAgentCommandPrefix } from '@shared/agent-command-prefix';
import type { Branch } from '@shared/git';
import type { QuickAction } from '@shared/project-settings';
import type { RuntimeId } from '@shared/runtime-registry';
import { ensureUniqueTaskSlug } from '@shared/task-name';
import type { MountedProject } from '@renderer/features/projects/stores/project';

function slugifyLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'op';
}

function timestampSuffix(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * Spawn a one-shot task in the given project to run a quick-action command.
 * Uses no-worktree strategy so the task lives in the main repo. Returns the
 * new taskId, or null if prerequisites are missing.
 */
export async function runProjectCommand(args: {
  project: MountedProject;
  action: QuickAction;
  runtimeId: RuntimeId | null;
  defaultBranch: Branch | undefined;
}): Promise<string | null> {
  const { project, action, runtimeId, defaultBranch } = args;
  const command = runtimeId ? applyAgentCommandPrefix(runtimeId, action.command) : '';
  if (!command || !runtimeId || !defaultBranch) return null;

  const baseName = `ops-${slugifyLabel(action.label)}-${timestampSuffix(new Date())}`;
  const existing = Array.from(project.taskManager.tasks.values(), (t) => t.data.name);
  const taskName = ensureUniqueTaskSlug(baseName, existing);

  const taskId = crypto.randomUUID();
  await project.taskManager.createTask({
    id: taskId,
    projectId: project.data.id,
    name: taskName,
    sourceBranch: defaultBranch,
    strategy: { kind: 'no-worktree' },
    initialConversation: {
      id: crypto.randomUUID(),
      projectId: project.data.id,
      taskId,
      runtime: runtimeId,
      title: action.label || command,
      initialPrompt: command,
    },
  });
  return taskId;
}
