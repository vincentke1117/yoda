/** Minimal dependency-free line diff (LCS) for before/after previews. */

export interface DiffLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');

  // LCS table — SKILL.md files are small (hundreds of lines), O(n*m) is fine.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * cols + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * cols + j + 1] + 1
          : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) {
      lines.push({ kind: 'removed', text: a[i] });
      i += 1;
    } else {
      lines.push({ kind: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) lines.push({ kind: 'removed', text: a[i++] });
  while (j < b.length) lines.push({ kind: 'added', text: b[j++] });
  return lines;
}

/**
 * Collapse long unchanged runs to `context` lines around each change,
 * inserting `gap` marker rows where lines were elided.
 */
export interface DiffHunkLine {
  kind: 'context' | 'added' | 'removed' | 'gap';
  text: string;
}

export function collapseContext(lines: DiffLine[], context = 3): DiffHunkLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === 'context') return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(lines.length - 1, index + context);
      k += 1
    ) {
      keep[k] = true;
    }
  });

  const result: DiffHunkLine[] = [];
  let inGap = false;
  lines.forEach((line, index) => {
    if (keep[index]) {
      result.push(line);
      inGap = false;
    } else if (!inGap) {
      result.push({ kind: 'gap', text: '' });
      inGap = true;
    }
  });
  return result;
}
