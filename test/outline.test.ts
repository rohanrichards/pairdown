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
