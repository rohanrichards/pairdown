import { test, expect } from "bun:test";
import { blockRanges, blockAt } from "../client/blocks.js";

test("a heading and the paragraph under it are separate blocks", () => {
  const t = "# Title\n\nsome prose here\n";
  expect(blockRanges(t).map((b) => b.kind)).toEqual(["heading", "paragraph"]);
});

test("a fenced diagram is one block regardless of blank lines inside it", () => {
  const t = "before\n\n```svg\n<svg>\n\n</svg>\n```\n\nafter\n";
  const kinds = blockRanges(t).map((b) => b.kind);
  expect(kinds).toEqual(["paragraph", "fence", "paragraph"]);
});

test("a table is one block", () => {
  const t = "| a | b |\n|---|---|\n| 1 | 2 |\n";
  expect(blockRanges(t)).toHaveLength(1);
  expect(blockRanges(t)[0].kind).toBe("table");
});

test("block ranges cover their exact text", () => {
  const t = "# Title\n\nprose\n";
  const [head] = blockRanges(t);
  expect(t.slice(head.from, head.to)).toBe("# Title");
});

// GFM requires a header row *and* a delimiter row beneath it. Both directions
// of that rule need coverage: a real table is one block, and a paragraph that
// merely contains a bare pipe is not mistaken for one.
test("a real two-line table with a delimiter row is one table block", () => {
  const t = "| Name | Role |\n| --- | --- |\n| Ada | Engineer |\n";
  const blocks = blockRanges(t);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].kind).toBe("table");
});

test("a paragraph containing a bare pipe is not classified as a table", () => {
  const t = "the plan costs $10 | $20 depending on tier\nmore prose follows\n";
  expect(blockRanges(t).map((b) => b.kind)).toEqual(["paragraph"]);
});

// Fence open/close is delegated to src/fences.ts, which matches delimiter
// character and length rather than treating any ``` line as a close. Both
// cases outlineOf had to fix once need coverage here too.
test("a three-backtick fence nested inside a four-backtick fence is one block", () => {
  const t = "````markdown\n```\n# not a heading\n```\n````\n";
  const blocks = blockRanges(t);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].kind).toBe("fence");
});

test("a tilde-fenced block is one block", () => {
  const t = "~~~svg\n<svg></svg>\n~~~\n";
  const blocks = blockRanges(t);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].kind).toBe("fence");
});

// DELIM_ROW alone matches a bare "---" (every part of it is optional), which
// would misclassify a paragraph containing a pipe followed by a horizontal
// rule, or a setext H2 underline, as a table. The candidate delimiter row
// must itself contain a "|".
test("a paragraph containing a pipe followed by a bare dash line is not a table", () => {
  const t = "the plan costs $10 | $20 depending on tier\n---\n";
  expect(blockRanges(t).map((b) => b.kind)).toEqual(["paragraph"]);
});

test("an image is its own block", () => {
  const t = "![a diagram](https://example.com/pic.png)\n";
  const blocks = blockRanges(t);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].kind).toBe("image");
});

test("a multi-item list is one block", () => {
  const t = "- one\n- two\n- three\n";
  const blocks = blockRanges(t);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].kind).toBe("list");
});

test("two consecutive paragraphs separated by a blank line are two blocks", () => {
  const t = "first paragraph\n\nsecond paragraph\n";
  expect(blockRanges(t).map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
});

test("a colon-aligned delimiter row still makes a table", () => {
  const t = "| Name | Role |\n|:--:|:--:|\n| Ada | Engineer |\n";
  const blocks = blockRanges(t);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].kind).toBe("table");
});

test("blockAt finds the block holding a position", () => {
  const t = "# Title\n\nfirst paragraph\n\nsecond paragraph\n";
  const blocks = blockRanges(t);
  expect(blockAt(blocks, 0).kind).toBe("heading");
  expect(blockAt(blocks, t.indexOf("first")).kind).toBe("paragraph");
  expect(t.slice(blockAt(blocks, t.indexOf("second")).from)).toStartWith("second");
});

test("blockAt includes both ends of a block", () => {
  const t = "# Title\n\nbody\n";
  const [head] = blockRanges(t);
  expect(blockAt(blockRanges(t), head.from)).not.toBeNull();
  expect(blockAt(blockRanges(t), head.to)).not.toBeNull();
});

test("blockAt returns null in the gap between blocks", () => {
  const t = "# Title\n\nbody\n";
  // the blank line separating the heading from the paragraph belongs to neither
  const gap = t.indexOf("\n\n") + 1;
  expect(blockAt(blockRanges(t), gap)).toBeNull();
});

test("blockAt returns null past the end of the document", () => {
  const t = "# Title\n";
  expect(blockAt(blockRanges(t), 999)).toBeNull();
});
