import { test, expect } from "bun:test";
import { Room } from "../src/room";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";

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

test("insertAfter normalises inserted markdown to the document's CRLF, like edit does", () => {
  const r = Room.load("abc", file(), "test");
  r.content.insert(0, "## One\r\nbody\r\n");
  expect(r.insertAfter("## One", "\n\nadded\nmore").ok).toBe(true);
  expect(r.text()).toBe("## One\r\n\r\nadded\r\nmore\r\nbody\r\n");
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

test("save writes through a temp file, so a failed write leaves the previous state intact", () => {
  const f = file();
  const r = Room.load("abc", f, "test");
  r.content.insert(0, "first good state");
  r.save();
  const good = readFileSync(f);

  // A directory sitting where the temp file goes makes the write fail. Under an
  // in-place write this is the moment the room's only copy is truncated; under
  // a write-then-rename the target is not touched at all.
  mkdirSync(`${f}.tmp`, { recursive: true });
  r.content.insert(r.content.length, " and more");
  expect(() => r.save()).not.toThrow();
  expect(readFileSync(f)).toEqual(good);
});

test("save leaves no temp file behind", () => {
  const f = file();
  const r = Room.load("abc", f, "test");
  r.content.insert(0, "some content");
  r.save();
  expect(existsSync(f)).toBe(true);
  expect(existsSync(`${f}.tmp`)).toBe(false);
});

test("a torn state file is moved aside and the room opens instead of throwing", () => {
  const f = file();
  const seed = Room.load("abc", f, "test");
  seed.content.insert(0, "# Title\n\nbody that will be truncated");
  seed.save();

  // Half a Yjs update: Y.applyUpdate throws "Unexpected end of array" on any
  // truncated state, which is exactly what a crash mid-write leaves behind.
  const whole = readFileSync(f);
  const torn = whole.subarray(0, Math.floor(whole.length / 2));
  writeFileSync(f, torn);

  const reopened = Room.load("abc", f, "test");
  expect(reopened.text()).toBe("");
  // The bad bytes are kept rather than silently re-read on the next open.
  expect(existsSync(f)).toBe(false);
  expect(readFileSync(`${f}.corrupt`)).toEqual(torn);
});
