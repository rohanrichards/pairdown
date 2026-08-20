import { test, expect } from "bun:test";
import { anchorState, textDrifted } from "../src/anchor";

const slice = (s: string) => (from: number, to: number) => s.slice(from, to);

test("text that still matches the quote is not drift", () => {
  expect(textDrifted("bravo", "bravo")).toBe(false);
  // whitespace and case are normalised away
  expect(textDrifted("Bravo  charlie", "bravo charlie")).toBe(false);
  // a typo fix or a trimmed edge is still the same passage
  expect(textDrifted("bravo charlie", "bravo charlie delta")).toBe(false);
  expect(textDrifted("bravo charlie delta", "charlie")).toBe(false);
});

test("substituted text is drift even though the anchor still resolves", () => {
  expect(textDrifted("bravo", "delta")).toBe(true);
  expect(textDrifted("bravo", "")).toBe(true);
});

test("nothing to compare against is not drift", () => {
  expect(textDrifted("", "anything")).toBe(false);
});

test("anchorState names the three states the browser shows", () => {
  const doc = "alpha bravo charlie";
  expect(anchorState(6, 11, "bravo", slice(doc))).toEqual({ state: "ok", current: "bravo" });
  expect(anchorState(6, 11, "delta", slice(doc))).toEqual({ state: "changed", current: "bravo" });
  expect(anchorState(null, 11, "bravo", slice(doc))).toEqual({ state: "deleted", current: "" });
  expect(anchorState(6, null, "bravo", slice(doc))).toEqual({ state: "deleted", current: "" });
  // a range that collapsed to nothing, or inverted, is deleted rather than empty
  expect(anchorState(6, 6, "bravo", slice(doc))).toEqual({ state: "deleted", current: "" });
  expect(anchorState(11, 6, "bravo", slice(doc))).toEqual({ state: "deleted", current: "" });
});

test("anchorState reads the document only through the caller's slice", () => {
  // The browser clamps how much it will read; the companion does not. Sharing
  // the decision must not force one client's clamp on the other.
  const clamped = anchorState(0, 100, "alpha", (f, t) =>
    "alpha bravo charlie".slice(f, Math.min(t, f + 5)));
  expect(clamped).toEqual({ state: "ok", current: "alpha" });
});
