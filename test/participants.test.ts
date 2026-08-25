import { test, expect } from "bun:test";
import { pairParticipants, mentionQuery, mentionCandidates, mentionSlug } from "../client/participants.js";

const person = (name: string, extra: object = {}) => ({ name, color: "#111", me: false, ...extra });
const agent = (handle: string, owner?: string, extra: object = {}) => ({
  handle, label: owner ? `${handle} — ${owner}'s agent` : handle, owner, busy: false, ...extra,
});

// ---- pairing ---------------------------------------------------------------

test("an agent sits under the person who brought it", () => {
  const { participants, orphans } = pairParticipants(
    [person("Ian")],
    [agent("maple", "Ian")],
  );
  expect(participants).toHaveLength(1);
  expect(participants[0].name).toBe("Ian");
  expect(participants[0].agents.map((a) => a.handle)).toEqual(["maple"]);
  expect(orphans).toEqual([]);
});

test("owner matching ignores case and surrounding space", () => {
  const { participants, orphans } = pairParticipants(
    [person("Ian")],
    [agent("maple", "  ian  ")],
  );
  expect(participants[0].agents).toHaveLength(1);
  expect(orphans).toEqual([]);
});

test("an agent whose owner is not in the room stands on its own", () => {
  const { participants, orphans } = pairParticipants(
    [person("Rohan")],
    [agent("maple", "Ian")],
  );
  expect(participants[0].agents).toEqual([]);
  expect(orphans.map((a) => a.handle)).toEqual(["maple"]);
});

test("an agent with no owner at all is an orphan, not silently attached to someone", () => {
  const { participants, orphans } = pairParticipants(
    [person("Rohan")],
    [agent("claude", undefined)],
  );
  expect(participants[0].agents).toEqual([]);
  expect(orphans.map((a) => a.handle)).toEqual(["claude"]);
});

test("one person can bring more than one agent", () => {
  const { participants } = pairParticipants(
    [person("Rohan")],
    [agent("ren", "Rohan"), agent("scout", "Rohan")],
  );
  expect(participants[0].agents.map((a) => a.handle)).toEqual(["ren", "scout"]);
});

test("people with no agent still appear", () => {
  const { participants } = pairParticipants([person("Ian"), person("Rohan")], []);
  expect(participants.map((p) => p.name)).toEqual(["Ian", "Rohan"]);
  expect(participants.every((p) => p.agents.length === 0)).toBe(true);
});

test("a busy agent carries its busy flag through pairing", () => {
  const { participants } = pairParticipants(
    [person("Ian")],
    [agent("maple", "Ian", { busy: true, comment_id: "c1" })],
  );
  expect(participants[0].agents[0].busy).toBe(true);
  expect(participants[0].agents[0].comment_id).toBe("c1");
});

// ---- finding the mention under the caret -----------------------------------

test("a bare @ at the caret opens the menu with an empty query", () => {
  expect(mentionQuery("@", 1)).toEqual({ from: 0, to: 1, query: "" });
});

test("the query is the text between the @ and the caret", () => {
  expect(mentionQuery("@cl", 3)).toEqual({ from: 0, to: 3, query: "cl" });
  expect(mentionQuery("hey @cl", 7)).toEqual({ from: 4, to: 7, query: "cl" });
});

test("a caret in the middle of a handle still replaces the whole handle", () => {
  // "@ren" with the caret after "@r" — completing must not leave "en" behind.
  expect(mentionQuery("@ren", 2)).toEqual({ from: 0, to: 4, query: "r" });
});

test("an @ inside a word is not a mention, so an email never opens the menu", () => {
  expect(mentionQuery("a@b", 3)).toBeNull();
  expect(mentionQuery("mail rohan@portable", 19)).toBeNull();
});

test("a caret outside the mention returns nothing", () => {
  expect(mentionQuery("@ren and more", 13)).toBeNull();
  expect(mentionQuery("@ren", 0)).toBeNull();
});

test("a space ends the mention", () => {
  expect(mentionQuery("@ren ", 5)).toBeNull();
});

test("a newline ends the mention", () => {
  expect(mentionQuery("@ren\nnext", 9)).toBeNull();
});

test("an @ after punctuation still counts", () => {
  expect(mentionQuery("(@re", 4)).toEqual({ from: 1, to: 4, query: "re" });
});

// ---- what the menu offers --------------------------------------------------

const room = {
  people: [person("Ian"), person("Rohan", { me: true })],
  agents: [agent("maple", "Ian"), agent("ren", "Rohan")],
};

test("an empty query offers every agent and person", () => {
  const c = mentionCandidates("", room);
  expect(c.map((x) => x.insert).sort()).toEqual(["Ian", "Rohan", "maple", "ren"]);
});

test("agents are offered before people, because only agents get notified", () => {
  const c = mentionCandidates("", room);
  expect(c[0].kind).toBe("agent");
  expect(c.at(-1).kind).toBe("person");
});

test("matching is case-insensitive on both sides", () => {
  expect(mentionCandidates("MAP", room).map((x) => x.insert)).toEqual(["maple"]);
  expect(mentionCandidates("ia", room).map((x) => x.insert)).toEqual(["Ian"]);
});

test("a prefix match ranks above a mid-word match", () => {
  const c = mentionCandidates("en", { people: [], agents: [agent("en-agent"), agent("ren")] });
  expect(c.map((x) => x.insert)).toEqual(["en-agent", "ren"]);
});

test("a query matching nothing offers nothing", () => {
  expect(mentionCandidates("zzz", room)).toEqual([]);
});

test("an agent's owner is searchable, so typing a person's name finds their agent", () => {
  const c = mentionCandidates("ian", room);
  expect(c.map((x) => x.insert)).toContain("maple");
});

test("each candidate says whether it actually notifies anyone", () => {
  const c = mentionCandidates("", room);
  const maple = c.find((x) => x.insert === "maple");
  const ian = c.find((x) => x.insert === "Ian");
  expect(maple.notifies).toBe(true);
  expect(ian.notifies).toBe(false);
});

test("you are marked in your own row so you do not ping yourself by accident", () => {
  const c = mentionCandidates("rohan", room);
  expect(c.find((x) => x.insert === "Rohan").me).toBe(true);
});

test("a person is offered once even when they brought several agents", () => {
  const c = mentionCandidates("", {
    people: [person("Rohan")],
    agents: [agent("ren", "Rohan"), agent("scout", "Rohan")],
  });
  expect(c.filter((x) => x.insert === "Rohan")).toHaveLength(1);
});

// ---- names that are not mention-safe ---------------------------------------

test("a multi-word name becomes one mentionable token", () => {
  expect(mentionSlug("Rename check")).toBe("Rename-check");
  expect(mentionSlug("  Ian  ")).toBe("Ian");
});

test("characters a mention cannot carry are dropped", () => {
  // The mention grammar is letters, digits and hyphens; anything else would
  // silently truncate the handle when parsed back out of the comment body.
  expect(mentionSlug("Ian O'Brien")).toBe("Ian-OBrien");
  expect(mentionSlug("José")).toBe("Jos");
});

test("a name that slugs away entirely is not offered as a mention", () => {
  const c = mentionCandidates("", { people: [person("???")], agents: [] });
  expect(c).toEqual([]);
});

test("a multi-word person is inserted as their slug", () => {
  const c = mentionCandidates("ren", { people: [person("Rename check")], agents: [] });
  expect(c[0].insert).toBe("Rename-check");
  expect(c[0].label).toBe("Rename check");
});
