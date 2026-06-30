export function summarizeLlmDebugError(error: string): string {
  const messages = extractJsonErrorMessages(error);
  const apiError = [...messages].reverse().map(extractNestedApiErrorMessage).find(Boolean);
  if (apiError) return apiError;

  const lastMessage = messages.at(-1);
  if (lastMessage) return lastMessage;

  return error;
}

function extractJsonErrorMessages(error: string): string[] {
  return error
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => extractJsonErrorMessage(line))
    .filter((message) => message.length > 0);
}

function extractJsonErrorMessage(line: string): string[] {
  const jsonStart = line.indexOf('{');
  if (jsonStart === -1) return [];
  try {
    const event = JSON.parse(line.slice(jsonStart)) as {
      error?: { message?: unknown };
      item?: { message?: unknown };
      message?: unknown;
    };
    const message = event.error?.message ?? event.item?.message ?? event.message;
    return typeof message === 'string' ? [message] : [];
  } catch {
    return [];
  }
}

function extractNestedApiErrorMessage(message: string): string | undefined {
  const jsonStart = message.indexOf('{');
  if (jsonStart === -1) return undefined;
  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === 'string' ? parsed.error.message : undefined;
  } catch {
    return undefined;
  }
}
