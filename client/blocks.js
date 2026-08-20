// One block, one section. A heading is a block; the paragraph under it is a
// different block; a diagram is a block. That is the correction from the
// original spec, which called a "section" a heading plus everything under
// it — rejected because a block boundary is already visible on screen, so it
// is obvious where a comment will attach.
//
// A table needs a header row *and* a delimiter row beneath it (the GFM rule),
// where the delimiter row is only pipes, colons, hyphens and whitespace — for
// example `|---|:--:|`. A line that merely contains a bare `|` (a price, a
// typo) stays a paragraph; only a header line followed by a real delimiter
// row earns "table".
//
// Fence open/close is delegated to src/fences.ts rather than reimplemented
// here: a naive "any ``` line closes it" check misreads a nested fence with a
// shorter delimiter and does not recognise ~~~ fences at all — the exact bug
// outlineOf had and fixed, which is why the rule lives in one shared place.
import { fenceOpener, closesFence } from "../src/fences";

const DELIM_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export function blockRanges(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0, offset = 0;
  const lineLen = (n) => lines[n].length + 1;

  while (i < lines.length) {
    const start = offset;
    const line = lines[i];
    if (!line.trim()) { offset += lineLen(i); i++; continue; }

    const opener = fenceOpener(line);
    if (opener) {
      let j = i + 1, len = lineLen(i);
      while (j < lines.length && !closesFence(lines[j], opener)) { len += lineLen(j); j++; }
      if (j < lines.length) { len += lineLen(j); j++; }
      out.push({ from: start, to: start + len - 1, kind: "fence" });
      offset += len; i = j; continue;
    }

    let kind = "paragraph";
    if (/^#{1,6}\s/.test(line)) kind = "heading";
    else if (/^\s*([-*+]|\d+\.)\s/.test(line)) kind = "list";
    else if (line.includes("|") && i + 1 < lines.length && DELIM_ROW.test(lines[i + 1])) kind = "table";
    else if (/^!\[[^\]]*\]\(/.test(line)) kind = "image";

    let j = i, len = 0;
    const single = kind === "heading" || kind === "image";
    do { len += lineLen(j); j++; } while (!single && j < lines.length && lines[j].trim());
    out.push({ from: start, to: start + len - 1, kind });
    offset += len; i = j;
  }
  return out;
}
