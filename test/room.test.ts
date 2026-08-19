import { test, expect } from "bun:test";
import { Room } from "../src/room";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

const file = () => join(tmpdir(), `room-${Math.random().toString(36).slice(2)}.bin`);

test("edit replaces one unique passage", () => {
  const r = Room.load("abc", file(), "test");
  r.content.insert(0, "# Title\n\nhello world\n");
  expect(r.edit("hello world", "goodbye world").ok).toBe(true);
  expect(r.text()).toContain("goodbye world");
});

test("edit refuses a passage that is not unique", () => {
  const r = Room.load("abc", file(), "test");
  r.content.insert(0, "same\nsame\n");
  expect(r.edit("same", "x")).toEqual({ ok: false, reason: "text is not unique" });
});

test("edit matches an LF needle against a CRLF document", () => {
  const r = Room.load("abc", file(), "test");
  r.content.insert(0, "## Heading\r\nsecond line\r\n");
  expect(r.edit("## Heading\nsecond line", "## Heading\nreplaced").ok).toBe(true);
  expect(r.text()).toContain("replaced");
});

test("insertAfter places text below the anchor, not over it", () => {
  const r = Room.load("abc", file(), "test");
  r.content.insert(0, "## One\nbody\n\n## Two\n");
  expect(r.insertAfter("## One", "\n\nadded").ok).toBe(true);
  expect(r.text()).toBe("## One\n\nadded\nbody\n\n## Two\n");
});

test("save does not throw when path is invalid", () => {
  // Create a temporary file, then try to use a path that treats it as a directory.
  // This should cause mkdirSync or writeFileSync to fail.
  const blockingFile = join(tmpdir(), `room-blocker-${Math.random().toString(36).slice(2)}.bin`);
  writeFileSync(blockingFile, "");
  const invalidPath = join(blockingFile, "nested.bin");

  const r = Room.load("test", invalidPath, "test");
  r.content.insert(0, "test content");

  // This should not throw, even though the path is invalid
  expect(() => r.save()).not.toThrow();
});
