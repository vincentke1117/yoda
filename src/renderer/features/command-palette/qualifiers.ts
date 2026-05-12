export type ParsedQuery = {
  /** Query with all recognised qualifiers stripped, ready to feed into search. */
  text: string;
  /** Set when `in:sessions` was present anywhere in the input. */
  inSessions: boolean;
};

const IN_SESSIONS_RE = /(^|\s)in:sessions(?=\s|$)/i;

export function parseQuery(raw: string): ParsedQuery {
  const inSessions = IN_SESSIONS_RE.test(raw);
  const text = raw.replace(IN_SESSIONS_RE, ' ').replace(/\s+/g, ' ').trim();
  return { text, inSessions };
}

export function toggleInSessionsQualifier(raw: string, on: boolean): string {
  const stripped = raw.replace(IN_SESSIONS_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!on) return stripped;
  return stripped ? `in:sessions ${stripped}` : 'in:sessions';
}
