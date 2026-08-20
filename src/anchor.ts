// Where a comment actually points, now.
//
// Shared by the browser (client/editor.js) and the agent's companion
// (src/mcp.ts) so the two clients of the same CRDT cannot disagree about what a
// comment means. The browser had this right and the agent did not: it resolved
// the anchor and printed whatever now occupies those positions as "the passage
// the comment is on", which is the one failure the three states exist to catch.
//
// Three states, not two. A comment loses its text by deletion, in which case
// the anchor stops resolving — but it can also lose its text by substitution,
// where the anchor still resolves perfectly onto whatever now sits there. That
// second case is the dangerous one: it looks correct while pointing at words
// nobody commented on.

export type AnchorState = "ok" | "deleted" | "changed";

/** Normalise for comparison: whitespace runs collapse, case is ignored. */
export const squash = (s: unknown): string =>
  String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Has the anchored text changed out from under the comment?
 *
 * Deliberately strict: normalised equality, or one string containing the other
 * so a typo fix or a trimmed edge still counts as the same passage. Anything
 * else is called drift. Over-flagging is the safer failure — a comment marked
 * detached when the text merely moved is a small annoyance, while a comment
 * silently pointing at unrelated words is misinformation.
 */
export function textDrifted(quote: unknown, current: unknown): boolean {
  const q = squash(quote), c = squash(current);
  if (!q) return false;            // nothing to compare against
  if (!c) return true;             // range collapsed to nothing
  if (q === c) return false;
  return !(c.includes(q) || q.includes(c));
}

/**
 * Resolve a comment's anchor to one of the three states, and to the text now
 * sitting under it.
 *
 * `slice` is supplied by the caller because the two clients hold the document
 * in different shapes — a CodeMirror `Text` in the browser, a plain string in
 * the companion — and each clamps how much it is willing to read.
 */
export function anchorState(
  from: number | null,
  to: number | null,
  quote: unknown,
  slice: (from: number, to: number) => string,
): { state: AnchorState; current: string } {
  if (from === null || to === null || to <= from) return { state: "deleted", current: "" };
  const current = slice(from, to);
  return { state: textDrifted(quote, current) ? "changed" : "ok", current };
}
