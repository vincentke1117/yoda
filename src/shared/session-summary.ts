/**
 * Which parts of the conversation feed a generated session summary. Summaries
 * are a pure text task — `project` adds only a one-line "name @ path" header,
 * never repository scanning, so toggles never slow generation by doing IO.
 */
export const SUMMARY_CONTEXT_SOURCE_IDS = ['user', 'assistant', 'project'] as const;

export type SummaryContextSourceId = (typeof SUMMARY_CONTEXT_SOURCE_IDS)[number];

export type SummaryContext = Record<SummaryContextSourceId, boolean>;

/**
 * `recent` is the always-on one-line note; default to the cheapest input
 * (user messages only) so it refreshes fast after every reply.
 */
export const DEFAULT_SUMMARY_CONTEXT_RECENT: SummaryContext = {
  user: true,
  assistant: false,
  project: false,
};

/** `global` is a whole-session digest, so include everything by default. */
export const DEFAULT_SUMMARY_CONTEXT_GLOBAL: SummaryContext = {
  user: true,
  assistant: true,
  project: true,
};
