# Pairdown

Multiplayer markdown, with agents in the room.

One server holds every document. People open a link and edit the same document
together, live, and leave comments in the margin. Anyone in the room can bring
their own Claude Code session in with them — it appears as a named participant,
sits quiet until somebody mentions it, and then answers in the thread it was
called into.

It works in a browser with nothing installed. Rooms, editing, comments and
sharing all work with no agent attached anywhere; the Claude Code plugin is the
optional way to attach a session, and it never holds the document itself.

## Run the server

```bash
bun install
bun run build          # bundles the browser client into public/js
bun run src/server.ts  # http://127.0.0.1:8790
```

One process serves every room. `/` is the room index — every room on the
server, linked to its own `/r/<id>`, with a form to create one. Rooms persist
under `data/rooms/`, one file each, and outlive the process.

## Bring an agent

```bash
claude --plugin-dir .
```

The plugin runs an MCP server that connects to the room server as a client. Its
`pairdown` binary, on `PATH` while the plugin is enabled, starts the room server
on demand if it isn't already up.

Once attached, a session calls `room_list`, then `room_create` or `room_join`,
then works with `read`, `outline`, `search`, `edit`, `append`, `insert`,
`comments`, `reply` and `resolve`.

An agent is dormant until named. Nothing reaches a session unless a comment
mentions its handle, so a room with four agents in it is as quiet as a room with
none until somebody asks for one of them.

| Variable | What it does |
|---|---|
| `PAIRDOWN_AGENT` | this session's handle, what people type after `@` (default `claude`) |
| `PAIRDOWN_OWNER` | whose agent it is, shown beside the handle |
| `PAIRDOWN_URL` | room server to attach to (default `ws://127.0.0.1:8790`) |
| `PAIRDOWN_SECRET` | shared key, when the server is gated |

Mentioning a handle notifies that session immediately; an untagged comment waits
until someone presses "send to claude". Immediate notification additionally
needs the channels research preview, and on Team/Enterprise an org admin must
set `channelsEnabled` — without it the notification is dropped silently and
everything else still works.

## The shared-key gate

Setting `PAIRDOWN_SECRET` puts the whole server behind one key: browsers get a
form and then a session cookie, agents and scripts send
`Authorization: Bearer <key>`. Unset, the server is open, exactly as before.

```bash
PAIRDOWN_SECRET="$(openssl rand -base64 32 | tr -d /+= )" bun run src/server.ts
```

This is authentication, not authorisation. One key means everyone holding it is
the same principal: nobody can be told apart, nobody can be revoked
individually, and every room on the server is behind the same door. It exists so
a supervised demo can go through a tunnel without handing the box to whoever
finds the URL. It is not a way to leave a server up.

What it does do properly is the part this kind of gate usually gets wrong: the
comparison is constant-time, the cookie carries an HMAC of the key rather than
the key, and the websocket upgrade is gated along with the pages — gating the
HTML but not `/ws` would lock the door and leave the window open.

## Test

```bash
bun test
bun run src/smoke.ts
```

`smoke.ts` seeds a throwaway room, spawns the MCP server against it, and drives
the whole tool surface end to end.

## Not here yet

Accounts, SSO, per-room permissions, hosting. Local first, a tunnel to demo.

See `docs/superpowers/specs/2026-08-19-spec-room-design.md` for the design. It
and the plan beside it are dated records written under the project's first name,
and are left as they were.
