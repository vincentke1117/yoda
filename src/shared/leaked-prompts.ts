import { z } from 'zod';

/** github repo the reference gallery is sourced from. */
export const LEAKED_PROMPTS_REPO = 'jujumilk3/leaked-system-prompts';

/**
 * A leaked system prompt from the community-maintained
 * github.com/jujumilk3/leaked-system-prompts collection, surfaced read-only in
 * the prompt library's reference gallery. A bundled snapshot ships with the app
 * (offline + instant); the runtime revalidates it against GitHub. Distinct from
 * the user's own saved `Prompt`s — these are reference material, copied out
 * on demand, never edited in place.
 */
export const leakedPromptMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  vendor: z.string(),
  date: z.string(),
  filename: z.string(),
  githubUrl: z.string(),
});
export type LeakedPromptMeta = z.infer<typeof leakedPromptMetaSchema>;

export const leakedPromptListSchema = z.object({
  /** Commit the bundled snapshot was generated from. */
  sourceCommit: z.string(),
  /** Whether the list reflects a successful runtime revalidation this session. */
  revalidated: z.boolean(),
  entries: z.array(leakedPromptMetaSchema),
});
export type LeakedPromptList = z.infer<typeof leakedPromptListSchema>;

/** Pretty display names for the vendor prefix parsed off each filename. */
const VENDOR_DISPLAY: Record<string, string> = {
  anthropic: 'Anthropic',
  claude: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  microsoft: 'Microsoft',
  xai: 'xAI',
  meta: 'Meta',
  moonshot: 'Moonshot',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  perplexity: 'Perplexity',
  codeium: 'Codeium',
  cursor: 'Cursor',
  github: 'GitHub',
  v0: 'Vercel v0',
  devin: 'Devin',
  manus: 'Manus',
  cline: 'Cline',
  replit: 'Replit',
  lovable: 'Lovable',
  notion: 'Notion',
  discord: 'Discord',
  proton: 'Proton',
  duckai: 'DuckDuckGo',
  brave: 'Brave',
  opera: 'Opera',
  canva: 'Canva',
  docker: 'Docker',
  rovo: 'Atlassian',
  snap: 'Snap',
  colab: 'Google',
  naver: 'Naver',
  wrtn: 'Wrtn',
  phind: 'Phind',
  devv: 'Devv',
  cluely: 'Cluely',
  gandalf: 'Lakera',
  roblox: 'Roblox',
  scamguard: 'Malwarebytes',
};

/**
 * Parse `anthropic-claude-opus-4.7_20260416(-1)?.md` → reference metadata.
 * Shared by the snapshot generator and the runtime revalidation so new entries
 * discovered on GitHub render identically to bundled ones.
 */
export function parseLeakedPromptFilename(filename: string): LeakedPromptMeta {
  const id = filename.replace(/\.md$/, '');
  const dateMatch = id.match(/_(\d{8})(?:-\d+)?$/);
  const date = dateMatch
    ? `${dateMatch[1].slice(0, 4)}-${dateMatch[1].slice(4, 6)}-${dateMatch[1].slice(6, 8)}`
    : '';
  const slug = dateMatch ? id.slice(0, dateMatch.index) : id;
  const vendorKey = slug.split(/[-_]/)[0].toLowerCase();
  const vendor = VENDOR_DISPLAY[vendorKey] ?? vendorKey.replace(/^\w/, (c) => c.toUpperCase());
  return {
    id,
    title: slug.replace(/[-_]/g, ' '),
    vendor,
    date,
    filename,
    githubUrl: `https://github.com/${LEAKED_PROMPTS_REPO}/blob/main/${filename}`,
  };
}
