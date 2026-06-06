const UI_SOURCE_LOCATOR_RE = /@[^\s@()]+:\d+:\d+\([^()\n]*>[^()\n]*\)/g;

export function displaySessionPromptText(text: string): string {
  return text
    .replace(UI_SOURCE_LOCATOR_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
