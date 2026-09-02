/**
 * Where a path ends inside prose is not decidable by pattern alone: `（`, `，`
 * and spaces all appear inside real filenames *and* start the annotation that
 * follows one. The regex layer therefore takes the generous reading, and this
 * module enumerates the shorter readings so the verification layer can ask the
 * filesystem which one exists.
 *
 * Variants are ordered longest-first, are always prefixes of the input (so the
 * matched cell range only ever shrinks), and never cut into the directory part
 * — a wrong basename is recoverable, a wrong directory is a different file.
 */

/** Characters that may end a path or may sit inside a filename. */
const TRIM_BOUNDARY_RE = /[ \t()（）[\]{}【】「」『』〈〉《》,，、。；;!！?？]/u;
/** Punctuation that is never the last character of a real path. */
const TRAILING_PUNCTUATION_RE = /[\s()（）[\]{}【】「」『』〈〉《》,，、。；;:：!！?？.·…]+$/u;
const LOCATION_SUFFIX_RE = /:\d+(?::\d+)?$/;

/** Beyond a handful of trimmings the guesses stop being plausible. */
const DEFAULT_MAX_VARIANTS = 6;

export function buildTerminalFileLinkTrimVariants(
  text: string,
  maxVariants = DEFAULT_MAX_VARIANTS
): string[] {
  // `:12:3` belongs to the untrimmed reading only — once the basename changes,
  // the line number was part of the prose, not the link.
  const locationSuffix = LOCATION_SUFFIX_RE.exec(text)?.[0] ?? '';
  const path = locationSuffix ? text.slice(0, -locationSuffix.length) : text;
  // A trailing slash already states where the path ends. Trimming one would
  // also have to re-attach the slash, which no longer lines up with the cells
  // the regex matched, so leave directory links to the pattern layer.
  if (path.endsWith('/')) return [text];

  const basenameStart = path.lastIndexOf('/') + 1;
  const variants = [text];
  for (let i = path.length - 1; i > basenameStart && variants.length < maxVariants; i--) {
    if (!TRIM_BOUNDARY_RE.test(path[i])) continue;
    const variant = path.slice(0, i).replace(TRAILING_PUNCTUATION_RE, '');
    if (variant.length <= basenameStart) break;
    if (!variants.includes(variant)) variants.push(variant);
  }
  return variants;
}
