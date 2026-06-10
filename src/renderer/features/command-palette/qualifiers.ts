/** The mutually-exclusive search scope. `all` applies no qualifier. */
export type SearchScope = 'all' | 'sessions' | 'tasks' | 'projects' | 'actions';

export type ParsedQuery = {
  /** Query with all recognised qualifiers stripped, ready to feed into search. */
  text: string;
  /** The active scope — at most one qualifier is honoured. */
  scope: SearchScope;
  /** True when `in:workspace` is present — restricts results to the active workspace. */
  workspace: boolean;
};

/** A scope qualifier (`in:<name>`) and its matching regex. */
const QUALIFIERS: Record<Exclude<SearchScope, 'all'>, RegExp> = {
  sessions: /(^|\s)in:sessions(?=\s|$)/i,
  tasks: /(^|\s)in:tasks(?=\s|$)/i,
  projects: /(^|\s)in:projects(?=\s|$)/i,
  actions: /(^|\s)in:actions(?=\s|$)/i,
};

/** Orthogonal modifier — combines with any scope rather than competing with them. */
const WORKSPACE_QUALIFIER = /(^|\s)in:workspace(?=\s|$)/i;

const SCOPE_ORDER: Exclude<SearchScope, 'all'>[] = ['sessions', 'tasks', 'projects', 'actions'];

export function parseQuery(raw: string): ParsedQuery {
  // First-matching qualifier wins; the scope chips are mutually exclusive.
  const scope = SCOPE_ORDER.find((name) => QUALIFIERS[name].test(raw)) ?? 'all';
  const workspace = WORKSPACE_QUALIFIER.test(raw);
  let text = raw.replace(WORKSPACE_QUALIFIER, ' ');
  for (const re of Object.values(QUALIFIERS)) text = text.replace(re, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return { text, scope, workspace };
}

/** Rewrites the query so it carries exactly the given scope (or none for `all`). */
export function setScope(raw: string, scope: SearchScope): string {
  let stripped = raw;
  for (const re of Object.values(QUALIFIERS)) stripped = stripped.replace(re, ' ');
  stripped = stripped.replace(/\s+/g, ' ').trim();
  if (scope === 'all') return stripped;
  const prefix = `in:${scope}`;
  return stripped ? `${prefix} ${stripped}` : prefix;
}
