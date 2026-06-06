export interface TaskBasicInfoFields {
  projectId?: string;
  projectName?: string;
  taskId?: string;
  taskName?: string;
  branchName?: string;
  providerName?: string;
  sessionId?: string;
  projectPath?: string;
  workingDirectory?: string;
  contentSourcePath?: string;
}

export interface TaskBasicInfoLabels {
  provider: string;
  project: string;
  projectPath: string;
  task: string;
  taskId: string;
  branch: string;
  sessionId: string;
  contentSource: string;
  readInstruction: string;
  readInstructionValue: string;
}

export function buildTaskBasicInfo(
  fields: TaskBasicInfoFields,
  labels: TaskBasicInfoLabels
): string | undefined {
  const projectPath = firstTrimmed(fields.workingDirectory, fields.projectPath);
  const rows: Array<[label: string, value: string | undefined]> = [
    [labels.task, fields.taskName],
    [labels.project, firstTrimmed(fields.projectName, fields.projectId)],
    [labels.projectPath, projectPath],
    [labels.branch, fields.branchName],
    [labels.taskId, fields.taskId],
    [labels.provider, fields.providerName],
    [labels.sessionId, fields.sessionId],
    [labels.contentSource, fields.contentSourcePath],
    [labels.readInstruction, fields.contentSourcePath ? labels.readInstructionValue : undefined],
  ];

  const parts = rows.flatMap(([label, value]) => {
    const trimmed = value?.trim();
    return trimmed ? [`${label}: ${trimmed}`] : [];
  });

  if (parts.length === 0) return undefined;

  return parts.join('\n');
}

function firstTrimmed(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
