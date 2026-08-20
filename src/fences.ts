// A fenced block closes only on a matching delimiter: same character
// (backtick or tilde), and at least as many of them. Anything shorter, or of
// the other character, is content — a nested ``` inside a ```` fence does not
// close it, and a ~~~ fence closes only on another ~~~ run.
//
// Shared by src/outline.ts and client/blocks.js so the rule lives in one
// place. outlineOf shipped this exact bug once (a naive "any ``` line
// closes it" check misread nested and tilde fences) and fixed it; extracting
// the fix here is what keeps a second implementation from repeating it.
const FENCE = /^(`{3,}|~{3,})/;

/** The exact delimiter run (e.g. "```" or "~~~~") if this line opens a fence, else null. */
export function fenceOpener(line: string): string | null {
  const m = line.match(FENCE);
  return m ? m[1] : null;
}

/** Does this line close a fence that was opened with `opener`? */
export function closesFence(line: string, opener: string): boolean {
  const m = line.match(FENCE);
  if (!m) return false;
  const delim = m[1];
  return delim[0] === opener[0] && delim.length >= opener.length;
}
