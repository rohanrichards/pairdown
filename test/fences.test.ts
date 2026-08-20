import { test, expect } from "bun:test";
import { fenceOpener, closesFence } from "../src/fences";

test("a non-fence line has no opener", () => {
  expect(fenceOpener("just prose")).toBeNull();
});

test("three or more backticks open a fence", () => {
  expect(fenceOpener("```svg")).toBe("```");
  expect(fenceOpener("````markdown")).toBe("````");
});

test("three or more tildes open a fence", () => {
  expect(fenceOpener("~~~")).toBe("~~~");
});

test("a matching close of the same length closes the fence", () => {
  expect(closesFence("```", "```")).toBe(true);
});

test("a longer closing run of the same character still closes", () => {
  expect(closesFence("````", "```")).toBe(true);
});

test("a shorter run does not close a longer opener — it is nested content", () => {
  expect(closesFence("```", "````")).toBe(false);
});

test("a different fence character does not close it", () => {
  expect(closesFence("~~~", "```")).toBe(false);
});

test("a tilde fence closes only on another tilde run", () => {
  expect(closesFence("~~~", "~~~")).toBe(true);
  expect(closesFence("```", "~~~")).toBe(false);
});
