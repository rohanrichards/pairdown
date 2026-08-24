// Who a comment is talking to.
//
// A room can hold several agents, each brought by a different person and each
// carrying that person's context. That only works if they can be told apart and
// addressed individually — otherwise one comment wakes all of them and they
// answer over each other.
//
// So agents are dormant until named. Nothing reaches a session unless a comment
// mentions its handle, which makes a room with four agents as quiet as a room
// with none until somebody asks for one of them.
//
// Mentions are parsed out of the comment body rather than stored as a flag. That
// keeps one source of truth — the text a person actually wrote — and it means
// rooms created before handles existed keep working untouched, because their
// comments say `@claude` and `claude` is still the default handle.

// A handle is letters, digits and hyphens. The lookbehind is what stops an email
// address counting: `rohan@portable.com.au` has a word character before the @.
const MENTION = /(?<![A-Za-z0-9._-])@([A-Za-z0-9-]+)/g;

/** Every agent handle named in a comment body, lowercased, in order, without repeats. */
export function mentionsIn(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(MENTION)) {
    const handle = m[1].toLowerCase();
    if (!out.includes(handle)) out.push(handle);
  }
  return out;
}

/** Does this text summon the agent with this handle? */
export function addressesMe(body: string, myHandle: string): boolean {
  return mentionsIn(body).includes(myHandle.toLowerCase());
}

/**
 * How an agent is shown to people in the room.
 *
 * The handle has to be unambiguous to type, so it cannot just be the owner's
 * name — `@rohan` would collide with Rohan the person. The owner is carried
 * alongside it instead, because whose context an agent holds is the only reason
 * to prefer one over another.
 */
export function agentLabel(handle: string, owner: string | undefined): string {
  if (!owner) return handle;
  const possessive = owner.endsWith("s") ? `${owner}'` : `${owner}'s`;
  return `${handle} — ${possessive} agent`;
}
