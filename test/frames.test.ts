import { test, expect } from "bun:test";
import { tag, untag } from "../src/frames";

test("a tagged frame round-trips its kind and payload", () => {
  const payload = new Uint8Array([1, 2, 3, 250]);
  const { kind, payload: back } = untag(tag(1, payload));
  expect(kind).toBe(1);
  expect([...back]).toEqual([1, 2, 3, 250]);
});
