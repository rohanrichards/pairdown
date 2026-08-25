// Who is in the room, and who you can address.
//
// Two separate presence lists — people over here, agents over there — made a
// room read as though the agents had wandered in by themselves. They have not:
// every agent was brought by somebody, carries that person's context, and is
// only in the room as long as they are. So an agent is shown underneath its
// owner, as part of one participant, and only stands alone when its owner is
// genuinely absent.
//
// This file is the part of that with no DOM in it, so it can be tested. The
// rendering lives in editor.js, which cannot be.

/** Owner names are typed by hand at both ends, so compare them forgivingly. */
const norm = (v) => String(v ?? "").trim().toLowerCase();

/** The mention grammar: letters, digits, hyphens. Kept in step with MENTION in src/address.ts. */
const HANDLE_CHAR = /[A-Za-z0-9-]/;

/** A character that stops an `@` counting as the start of a mention, so emails never do. */
const WORD_BEFORE = /[A-Za-z0-9._-]/;

/**
 * Fold a display name into something a mention can actually carry.
 *
 * People type their own names and they are not handles: "Rename check" has a
 * space, "Ian O'Brien" has an apostrophe, and the mention parser would stop
 * dead at both, silently mentioning someone who does not exist. Spaces become
 * hyphens and everything else outside the grammar is dropped.
 */
export function mentionSlug(name) {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .split("")
    .filter((c) => HANDLE_CHAR.test(c))
    .join("");
}

/**
 * Attach each agent to the person who brought it.
 *
 * Agents whose owner is not in the room are returned separately rather than
 * dropped: an agent still attached after its owner closed the tab is a real
 * thing that happens, and hiding it would leave a participant in the room that
 * nobody can see but who can still answer.
 */
export function pairParticipants(people, agents) {
  const claimed = new Set();
  const participants = people.map((p) => {
    const mine = agents.filter((a) => {
      const owned = norm(a.owner) !== "" && norm(a.owner) === norm(p.name);
      if (owned) claimed.add(a);
      return owned;
    });
    return { ...p, agents: mine };
  });
  return { participants, orphans: agents.filter((a) => !claimed.has(a)) };
}

/**
 * The mention being typed at the caret, or null.
 *
 * `to` runs past the caret to the end of the handle so that completing from
 * the middle of a half-typed name replaces all of it — otherwise picking
 * `@maple` with the caret after `@m` leaves `@mapleaple`.
 */
export function mentionQuery(text, caret) {
  const s = String(text ?? "");
  if (caret <= 0 || caret > s.length) return null;

  let i = caret;
  while (i > 0 && HANDLE_CHAR.test(s[i - 1])) i--;
  if (s[i - 1] !== "@") return null;

  const at = i - 1;
  // The same rule as the parser's lookbehind: a word character before the @
  // means this is an email or an address, not a mention.
  if (at > 0 && WORD_BEFORE.test(s[at - 1])) return null;

  let to = caret;
  while (to < s.length && HANDLE_CHAR.test(s[to])) to++;

  return { from: at, to, query: s.slice(at + 1, caret) };
}

/**
 * What the mention menu should offer for a query.
 *
 * Agents come first because they are the only rows that do anything: naming an
 * agent wakes it, naming a person is just text on a page. Every row says which
 * it is, so nobody types `@ian` believing it sent him something.
 */
export function mentionCandidates(query, { people = [], agents = [] } = {}) {
  const q = norm(query);

  const agentRows = agents.map((a) => {
    const handle = String(a.handle ?? "");
    // An agent is findable by its own handle, and by its owner's full name —
    // but only once that name is complete. Matching a prefix of the owner
    // would push somebody's agent above the person themselves while they were
    // still being typed.
    const hit = q === "" || norm(handle).includes(q) || (norm(a.owner) !== "" && norm(a.owner) === q);
    return hit && handle
      ? {
          kind: "agent",
          insert: handle,
          label: a.label || handle,
          detail: a.owner ? `${a.owner}'s agent` : "agent",
          notifies: true,
          busy: Boolean(a.busy),
          count: a.count ?? 1,
          handle,
          rank: norm(handle).startsWith(q) ? 0 : 1,
        }
      : null;
  });

  const seen = new Set();
  const peopleRows = people.map((p) => {
    const name = String(p.name ?? "");
    const slug = mentionSlug(name);
    // A name that leaves nothing behind cannot be mentioned at all, so offering
    // it would insert a bare "@".
    if (!slug || seen.has(norm(name))) return null;
    const hit = q === "" || norm(name).includes(q) || norm(slug).includes(q);
    if (!hit) return null;
    seen.add(norm(name));
    return {
      kind: "person",
      insert: slug,
      label: name,
      detail: p.me ? "you" : "in the room",
      notifies: false,
      me: Boolean(p.me),
      rank: norm(name).startsWith(q) || norm(slug).startsWith(q) ? 0 : 1,
    };
  });

  const keep = (rows) =>
    rows.filter(Boolean).map((r, i) => ({ ...r, order: i })).sort((a, b) => a.rank - b.rank || a.order - b.order);

  return [...keep(agentRows), ...keep(peopleRows)].map(({ rank, order, ...row }) => row);
}
