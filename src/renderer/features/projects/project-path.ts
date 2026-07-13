/** Joins a project root and repo-relative path without assuming the host OS. */
export function joinProjectPath(basePath: string, relativePath: string): string {
  const normalizedRelativePath = relativePath.replace(/^\/+/, '');
  if (!normalizedRelativePath) return basePath;
  const separator = basePath.includes('\\') && !basePath.includes('/') ? '\\' : '/';
  return `${basePath.replace(/[\\/]+$/, '')}${separator}${normalizedRelativePath.replace(
    /\//g,
    separator
  )}`;
}
