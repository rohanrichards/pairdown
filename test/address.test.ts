import { test, expect } from "bun:test";
import { mentionsIn, addressesMe, agentLabel } from "../src/address";

test("a mention is the handle after an @", () => {
  expect(mentionsIn("@claude please look at this")).toEqual(["claude"]);
  expect(mentionsIn("hey @ren can you check")).toEqual(["ren"]);
});

test("several agents can be addressed in one comment", () => {
  expect(mentionsIn("@ren and @maple both")).toEqual(["ren", "maple"]);
});

test("handles are matched case-insensitively and normalised", () => {
  expect(mentionsIn("@Claude and @REN")).toEqual(["claude", "ren"]);
});

test("an email address is not a mention", () => {
  expect(mentionsIn("mail rohan@portable.com.au about it")).toEqual([]);
});

test("an @ inside a word is not a mention", () => {
  expect(mentionsIn("the a@b thing")).toEqual([]);
});

test("punctuation after a handle is not part of it", () => {
  expect(mentionsIn("@ren, look")).toEqual(["ren"]);
  expect(mentionsIn("ask @ren.")).toEqual(["ren"]);
  expect(mentionsIn("(@ren)")).toEqual(["ren"]);
});

test("a handle can carry a hyphen but stops at other punctuation", () => {
  expect(mentionsIn("@ians-agent here")).toEqual(["ians-agent"]);
});

test("the same handle twice is one mention", () => {
  expect(mentionsIn("@ren @ren")).toEqual(["ren"]);
});

test("addressesMe is true only when my handle is named", () => {
  expect(addressesMe("@ren look", "ren")).toBe(true);
  expect(addressesMe("@ren look", "claude")).toBe(false);
  expect(addressesMe("no mention at all", "claude")).toBe(false);
});

test("addressesMe is case-insensitive about my own handle", () => {
  expect(addressesMe("@CLAUDE", "Claude")).toBe(true);
});

test("a legacy room saying @claude still reaches the default handle", () => {
  // Rooms created before handles existed all say @claude, and the default
  // handle is claude, so nothing has to be migrated.
  expect(addressesMe("fix this please @claude", "claude")).toBe(true);
});

test("the label carries provenance when an owner is set", () => {
  expect(agentLabel("ren", "Rohan")).toBe("ren — Rohan's agent");
  expect(agentLabel("ren", undefined)).toBe("ren");
  expect(agentLabel("ren", "")).toBe("ren");
});

test("an owner name already ending in s takes a bare apostrophe", () => {
  expect(agentLabel("ren", "Ians")).toBe("ren — Ians' agent");
});
