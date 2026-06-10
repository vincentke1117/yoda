export function* iterateLines(raw: string): Generator<string> {
  let start = 0;
  while (start < raw.length) {
    const newline = raw.indexOf('\n', start);
    if (newline === -1) {
      yield raw.slice(start);
      return;
    }
    yield raw.slice(start, newline);
    start = newline + 1;
  }
}
