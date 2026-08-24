# Multi-room

Pairdown works, and one document is now the thing stopping it being used for
real work. This room is the design conversation for fixing that — held in the
tool, about the tool.

The previous contents of this room (the comment UI design, its decisions and all
twelve threads) are archived in the repo at
`docs/archive/20260819-1845-comment-ui-room.md`, because losing a day's
reasoning to a wipe would be a poor advertisement for a spec tool.

## Decided already

**A room belongs to one session, because a spec is the artifact of one
session's conversation.** That is the whole reason the pairing exists. An agent
being woken by comments on three unrelated specs while working on a fourth isn't
merely noisy, it's incoherent — the context that makes the agent useful on a
spec is the conversation that produced it.

So: one room, one attached session. Not all rooms at once.

**And Claude is optional.** A room is a document people are working on; an agent
is a participant you choose to bring into it. Attached by default when you
publish a spec to share, because that is when you want it — but a colleague
opening the link a day later summons nobody, and a room with no agent is a
perfectly ordinary room rather than a broken one.

That requirement settles more than it looks. Today the agent process *is* the
room: it owns the document and serves the page, so a room cannot exist without an
agent attached to it. Making the agent optional means the room has to live
somewhere the agent isn't.

Two more things follow that are worth stating:

- **Any session can open any room.** The pairing is the default, not a lock. A
  colleague's session, or a fresh one, can read and edit a room it didn't create.
- **A room should know how to reopen its author.** If it records the session that
  created it, the tool can tell you the exact command to resume that
  conversation rather than leaving you to find it. The room becomes the index
  into your own history.

## The tension this creates

The web side and the agent side want opposite shapes.

A colleague opens a link. That link should be stable, and every room should live
behind the same address — one service, many rooms. But the agent side is spawned
by Claude Code, once per session. If each spawn also runs its own web server,
then two sessions means two processes, two ports, two different addresses, and a
room that exists only while its session happens to be running.

```svg
<svg viewBox="0 0 660 250" role="img" aria-label="Process per session versus one room server with thin clients">
  <text x="8" y="16" font-family="monospace" font-size="10" fill="#a8b0ab">TODAY — PROCESS PER SESSION</text>
  <rect x="8" y="28" width="150" height="40" rx="3" fill="none" stroke="#5d6662"/>
  <text x="83" y="52" text-anchor="middle" font-family="monospace" font-size="11" fill="#5d6662">session A</text>
  <rect x="182" y="28" width="170" height="40" rx="3" fill="none" stroke="#b0453f"/>
  <text x="267" y="46" text-anchor="middle" font-family="monospace" font-size="10" fill="#b0453f">server + doc + :8790</text>
  <text x="267" y="60" text-anchor="middle" font-family="monospace" font-size="9" fill="#b0453f">its own address</text>
  <line x1="160" y1="48" x2="180" y2="48" stroke="#5d6662"/>
  <rect x="8" y="80" width="150" height="40" rx="3" fill="none" stroke="#5d6662"/>
  <text x="83" y="104" text-anchor="middle" font-family="monospace" font-size="11" fill="#5d6662">session B</text>
  <rect x="182" y="80" width="170" height="40" rx="3" fill="none" stroke="#b0453f"/>
  <text x="267" y="98" text-anchor="middle" font-family="monospace" font-size="10" fill="#b0453f">server + doc + :8791</text>
  <text x="267" y="112" text-anchor="middle" font-family="monospace" font-size="9" fill="#b0453f">a different address</text>
  <line x1="160" y1="100" x2="180" y2="100" stroke="#5d6662"/>
  <text x="368" y="76" font-family="monospace" font-size="9" fill="#b0453f">rooms vanish with their session</text>

  <text x="8" y="164" font-family="monospace" font-size="10" fill="#a8b0ab">PROPOSED — ONE ROOM SERVER, THIN CLIENTS</text>
  <rect x="8" y="176" width="120" height="34" rx="3" fill="none" stroke="#5d6662"/>
  <text x="68" y="197" text-anchor="middle" font-family="monospace" font-size="11" fill="#5d6662">session A</text>
  <rect x="8" y="214" width="120" height="34" rx="3" fill="none" stroke="#5d6662"/>
  <text x="68" y="235" text-anchor="middle" font-family="monospace" font-size="11" fill="#5d6662">session B</text>
  <rect x="250" y="176" width="180" height="72" rx="3" fill="#e7ecf7" stroke="#24479e"/>
  <text x="340" y="202" text-anchor="middle" font-family="monospace" font-size="11" fill="#24479e">room server</text>
  <text x="340" y="219" text-anchor="middle" font-family="monospace" font-size="9" fill="#24479e">every room, one address</text>
  <text x="340" y="235" text-anchor="middle" font-family="monospace" font-size="9" fill="#24479e">/r/&lt;room&gt;</text>
  <line x1="130" y1="193" x2="248" y2="200" stroke="#24479e"/>
  <line x1="130" y1="231" x2="248" y2="224" stroke="#24479e"/>
  <rect x="470" y="190" width="120" height="44" rx="3" fill="none" stroke="#5d6662"/>
  <text x="530" y="217" text-anchor="middle" font-family="monospace" font-size="11" fill="#5d6662">browsers</text>
  <line x1="432" y1="212" x2="468" y2="212" stroke="#5d6662"/>
</svg>
```

## Three ways to resolve it

**A — One room server, sessions are thin clients.** A single long-lived process
owns every room and one address; the MCP companion holds no document of its own
and syncs one room over the same websocket protocol the browser uses. The agent
becomes just another client of the room.

*For:* stable addresses, rooms outlive their sessions, and an agent that is
genuinely optional — "no agent" is simply a client that is not connected, which
the presence indicator already shows. It is also the shape hosting will need: the
local server becomes a remote one with no change to either client.
*Against:* the document stops living in the MCP process, which is the biggest
change to what exists today. Something has to start the server and keep it
running.

**B — Process per session, as now, with rooms as separate files.** Each session
serves its own room on its own port. Almost no work.

*For:* nothing to redesign; ship it this afternoon.
*Against:* fails the requirement above outright. The agent owns the room, so
there is no such thing as a room without one — close the session and the
document is unreachable. Addresses move, shared links die, and hosting is
blocked, so the work gets thrown away.

**C — First session starts the server, later ones attach to it.** Whichever
session runs first hosts; the rest detect it and connect as clients.

*For:* no separate thing to run, and the addresses are stable while anyone is
working.
*Against:* the ugliest failure mode in the set — closing the wrong terminal takes
everyone's rooms down, and nobody can see which terminal is load-bearing. Also
fails the requirement in spirit: the agent is optional per room, but one agent
somewhere is always mandatory.

## Recommendation

**A**, and now for a reason stronger than taste. The document belongs to the room,
not to whoever happens to be attached to it. Once Claude is optional, that stops
being an architectural preference and becomes a requirement: a room nobody is
attached to still has to exist, be readable, and accept comments. Every hard
problem still on the list — hosting, a second person, real auth — assumes the
same thing. B is faster today and thrown
away next week; C hides which terminal is load-bearing, which is the kind of
thing that is fine until it is a disaster in front of an audience.

The honest cost of A: the document moves out of the MCP process, so `doc.ts`
stops owning a `Y.Doc` and starts syncing one. The agent then reads and writes
through exactly the path the browser already uses, which is a simplification
disguised as a rewrite.

## Open, and next

Comment on the option you want. After that, in rough order of how much they
change the design:

1. **Who starts the room server, and how does a session find it?** A `pairdown`
   command you leave running, something started on demand, or a service.
2. **How does a session end up in a room?** Created by the session, joined by id,
   or resumed from the room's record of its author.
3. **What is a room's identity?** A generated id in the URL, or a name someone
   chooses — and whether renaming keeps the link working.
4. **What happens to the room list?** Whether a person needs an index of their
   rooms, or the links they already have are enough.
