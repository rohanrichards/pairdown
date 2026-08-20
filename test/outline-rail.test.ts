import { test, expect } from "bun:test";
import { outlineOf } from "../src/outline";
import { sectionCounts } from "../client/outline-rail.js";

const doc = [
  "intro before any heading",     // preamble — no entry to hang a count on
  "",
  "# Title",                       // entry 0
  "",
  "body under Title",
  "",
  "## First section",              // entry 1
  "",
  "body under First section",
  "",
  "## Second section",             // entry 2 — runs to end of document
  "",
  "body under Second section",
  "",
].join("\n");

const entries = outlineOf(doc);
const at = (marker) => doc.indexOf(marker);

test("a position before the first heading counts nowhere", () => {
  const counts = sectionCounts(entries, [at("intro before any heading")]);
  expect(counts).toEqual([0, 0, 0]);
});

test("the last section counts everything up to the end of the document", () => {
  const nearEnd = doc.length - 1;
  const counts = sectionCounts(entries, [nearEnd]);
  expect(counts).toEqual([0, 0, 1]);
});

test("two comments in two different sections land against each, not a running total", () => {
  const counts = sectionCounts(entries, [at("body under Title"), at("body under First section")]);
  expect(counts).toEqual([1, 1, 0]);
});

test("several comments in one section sum correctly", () => {
  const positions = [
    at("body under Second section"),
    at("body under Second section") + 5,
    at("body under Second section") + 10,
  ];
  const counts = sectionCounts(entries, positions);
  expect(counts).toEqual([0, 0, 3]);
});

test("a position exactly at a heading's own offset counts against that heading, not the previous one", () => {
  const counts = sectionCounts(entries, [at("## Second section")]);
  expect(counts).toEqual([0, 0, 1]);
});

test("no comments at all gives every entry a zero count", () => {
  expect(sectionCounts(entries, [])).toEqual([0, 0, 0]);
});
