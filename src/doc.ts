// The shared document. One Yjs doc holding the spec text and its comments.
//
// Comments anchor to Yjs *relative positions* rather than character offsets or
// DOM paths, so an anchor stays attached to the text it was written about even
// as the surrounding document is edited concurrently. This is the part that
// artifact comments get wrong today: they anchor to CSS selector paths, which
// break the moment the document is restructured.
import * as Y from "yjs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Claude Code may spawn this from any working directory, so paths resolve
// from the project root rather than the cwd.
const ROOT = dirname(import.meta.dir);

const SEED = `# Untitled spec

Write the spec here. Anyone with the link can edit this text at the same time as
you, and select any part of it to leave a comment.

Mention @claude in a comment to ask the session attached to this document — the
one with the repository open — to answer or make the change.
`;


export const DOC_PATH = process.env.SPEC_ROOM_DOC ?? join(ROOT, "data", "doc.bin");

export const doc = new Y.Doc();
export const content = doc.getText("content");
export const comments = doc.getArray<Y.Map<unknown>>("comments");

if (existsSync(DOC_PATH)) {
  Y.applyUpdate(doc, new Uint8Array(readFileSync(DOC_PATH)));
} else if (content.length === 0) {
  content.insert(0, SEED);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
doc.on("update", () => {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(DOC_PATH), { recursive: true });
      writeFileSync(DOC_PATH, Y.encodeStateAsUpdate(doc));
    } catch (e) {
      process.stderr.write(`spec-room: save failed: ${e}\n`);
    }
  }, 300);
});

// ---- comment helpers -------------------------------------------------------

const b64 = {
  enc: (u: Uint8Array) => Buffer.from(u).toString("base64"),
  dec: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
};

export function anchorFor(index: number): string {
  return b64.enc(
    Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(content, index)),
  );
}

/** Resolve an anchor to a current index, or null if the text it referred to is gone. */
export function resolveAnchor(anchor: string): number | null {
  try {
    const abs = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(b64.dec(anchor)),
      doc,
    );
    return abs ? abs.index : null;
  } catch {
    return null;
  }
}

export type CommentView = {
  id: string;
  author: string;
  body: string;
  quote: string;
  from: number | null;
  to: number | null;
  resolved: boolean;
  forAgent: boolean;
  createdAt: string;
  replies: { author: string; body: string; at: string }[];
};

export function addComment(input: {
  author: string;
  body: string;
  from: number;
  to: number;
  quote: string;
}): string {
  const id = crypto.randomUUID().slice(0, 8);
  const m = new Y.Map<unknown>();
  doc.transact(() => {
    m.set("id", id);
    m.set("author", input.author);
    m.set("body", input.body);
    m.set("quote", input.quote);
    m.set("anchorFrom", anchorFor(input.from));
    m.set("anchorTo", anchorFor(input.to));
    m.set("resolved", false);
    // "@claude" is the explicit signal that this thread wants the agent.
    m.set("forAgent", /(^|\s)@claude\b/i.test(input.body));
    m.set("createdAt", new Date().toISOString());
    m.set("replies", new Y.Array());
    comments.push([m]);
  });
  return id;
}

function find(id: string): Y.Map<unknown> | null {
  for (const m of comments) if (m.get("id") === id) return m;
  return null;
}

export function replyTo(id: string, author: string, body: string): boolean {
  const m = find(id);
  if (!m) return false;
  const replies = m.get("replies") as Y.Array<unknown>;
  replies.push([{ author, body, at: new Date().toISOString() }]);
  return true;
}

export function setResolved(id: string, resolved: boolean): boolean {
  const m = find(id);
  if (!m) return false;
  m.set("resolved", resolved);
  return true;
}

export function viewComments(): CommentView[] {
  return comments.map((m) => ({
    id: m.get("id") as string,
    author: m.get("author") as string,
    body: m.get("body") as string,
    quote: m.get("quote") as string,
    from: resolveAnchor(m.get("anchorFrom") as string),
    to: resolveAnchor(m.get("anchorTo") as string),
    resolved: Boolean(m.get("resolved")),
    forAgent: Boolean(m.get("forAgent")),
    createdAt: m.get("createdAt") as string,
    replies: ((m.get("replies") as Y.Array<any>)?.toArray() ?? []) as any[],
  }));
}

/**
 * Surgical edit: replace the first occurrence of `find` with `replace`.
 * Deliberately NOT a whole-document write — the agent applies an operation into
 * the CRDT so a human typing elsewhere at the same moment is not clobbered.
 */
/**
 * Locate `needle`, tolerating a line-ending mismatch.
 *
 * A room seeded from a file written on Windows carries CRLF. An agent reads the
 * document, retypes a passage with plain LF, and every multi-line edit fails
 * with "text not found" - which happened, and left the document uneditable by
 * the agent while looking like a model mistake. Try the plausible variants
 * instead of making the caller guess which the document happens to hold.
 */
function locate(text: string, needle: string): { at: number; len: number; reason?: string } {
  const lf = needle.replace(/\r\n/g, "\n");
  const crlf = lf.replace(/\n/g, "\r\n");
  const variants = [needle, ...[lf, crlf].filter((v) => v !== needle)];
  for (const v of variants) {
    if (!v) continue;
    const at = text.indexOf(v);
    if (at === -1) continue;
    if (text.indexOf(v, at + 1) !== -1) return { at: -1, len: 0, reason: "text is not unique" };
    return { at, len: v.length };
  }
  return { at: -1, len: 0, reason: "text not found" };
}

export function editContent(needle: string, replacement: string): { ok: boolean; reason?: string } {
  const text = content.toString();
  const hit = locate(text, needle);
  if (hit.at === -1) return { ok: false, reason: hit.reason };
  // write the replacement in whatever endings the document already uses, so an
  // edit never leaves one section CRLF and the next LF
  const body = text.includes("\r\n") ? replacement.replace(/\r?\n/g, "\r\n") : replacement;
  doc.transact(() => {
    content.delete(hit.at, hit.len);
    content.insert(hit.at, body);
  });
  return { ok: true };
}

export function appendContent(markdown: string): void {
  content.insert(content.length, (content.length ? "\n\n" : "") + markdown);
}

