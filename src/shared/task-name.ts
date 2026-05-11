import { pinyin } from 'pinyin-pro';

export const MAX_TASK_NAME_LENGTH = 64;

/**
 * Display name: shown in UI, stored in tasks.name. Allows any Unicode (including CJK).
 * Only enforces trim + length cap.
 */
export const normalizeTaskDisplayName = (input: string): string =>
  input.trim().slice(0, MAX_TASK_NAME_LENGTH);

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TASK_NAME_LENGTH);

const containsCjk = (input: string): boolean => /[㐀-鿿豈-﫿]/.test(input);

/**
 * Derive a git-safe ASCII slug from a (possibly CJK) display name.
 * CJK characters are converted to lowercase pinyin without tone marks.
 * Result is `[a-z0-9-]+` and capped at MAX_TASK_NAME_LENGTH.
 */
export const deriveTaskSlug = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const romanized = containsCjk(trimmed)
    ? pinyin(trimmed, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('-')
    : trimmed;
  return slugify(romanized);
};

/**
 * Live-typing transform for free-form display names.
 * Allows any Unicode but caps length so typing past the limit is a no-op.
 */
export const liveTransformTaskDisplayName = (input: string): string =>
  input.slice(0, MAX_TASK_NAME_LENGTH);

/**
 * Extract a display-name candidate from the first user prompt.
 * Uses the first non-empty line, collapses inner whitespace, and caps length.
 * Returns an empty string if the prompt has no usable content.
 */
export const taskNameFromPrompt = (prompt: string): string => {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '';
  return normalizeTaskDisplayName(firstLine.replace(/\s+/g, ' '));
};

export const ensureUniqueTaskSlug = (
  baseName: string,
  existingNames: Iterable<string>,
  maxAttempts = 6
): string => {
  const normalizedExisting = new Set(
    Array.from(existingNames, (name) => deriveTaskSlug(name)).filter(Boolean)
  );
  const base = deriveTaskSlug(baseName);
  if (base && !normalizedExisting.has(base)) return base;

  for (let i = 2; i < 2 + maxAttempts; i++) {
    const candidate = deriveTaskSlug(`${baseName}-${i}`);
    if (candidate && !normalizedExisting.has(candidate)) {
      return candidate;
    }
  }

  const fallback = deriveTaskSlug(`${baseName}-${Date.now().toString(36)}`);
  return fallback || base;
};
