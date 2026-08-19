import { test, expect } from "bun:test";
import { outlineOf } from "../src/outline";

const doc = [
  "# Title",
  "",
  "intro words here",
  "",
  "## First section",
  "",
  "one two three four five",
  "",
  "```svg",
  "<svg></svg>",
  "```",
  "",
  "## Second section",
  "",
  "just a little text",
  "",
].join("\n");

test("every heading becomes an entry with its level and title", () => {
  const o = outlineOf(doc);
  expect(o.map((e) => [e.level, e.title])).toEqual([
    [1, "Title"],
    [2, "First section"],
    [2, "Second section"],
  ]);
});

test("word counts cover the section body, not the heading", () => {
  expect(outlineOf(doc)[1].words).toBe(5);
});

test("a section containing a fenced diagram is flagged", () => {
  const o = outlineOf(doc);
  expect(o[1].hasDiagram).toBe(true);
  expect(o[2].hasDiagram).toBe(false);
});

test("headings inside a fenced block are not treated as headings", () => {
  const tricky = "# Real\n\n```md\n# Not real\n```\n";
  expect(outlineOf(tricky).map((e) => e.title)).toEqual(["Real"]);
});

test("headings nested inside longer fence delimiters are not treated as headings", () => {
  const nested = "# Heading\n\n````markdown\n```\n# Not real\n```\n````\n\n## Next\n";
  expect(outlineOf(nested).map((e) => e.title)).toEqual(["Heading", "Next"]);
});

test("tilde fences work the same way as backtick fences", () => {
  const tildes = "# Real\n\n~~~md\n# Not real\n~~~\n";
  expect(outlineOf(tildes).map((e) => e.title)).toEqual(["Real"]);
});

test("offset points to the start of each heading line", () => {
  const text = "# First\n\nsome content\n\n```\nfenced\n```\n\n## Second\n";
  const o = outlineOf(text);

  // Verify offsets point to the first character of each heading
  expect(text.substring(o[0].offset, o[0].offset + 7)).toBe("# First");
  expect(text.substring(o[1].offset, o[1].offset + 9)).toBe("## Second");
});
