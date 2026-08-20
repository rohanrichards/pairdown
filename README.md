# spec-room

A collaborative markdown editor with an agent in the room. One server holds
every spec; people open a link and edit the same document together, live, and
leave comments in the margin. A Claude Code session can be invited into a room
to answer them.

It works in a browser with nothing installed — rooms, editing, comments and
sharing all work with no agent attached. The Claude Code plugin is the
optional way to attach a session to a room; it never runs the document
itself.

## Run the room server

```bash
bun run src/server.ts        # http://127.0.0.1:8790
```

This serves every room from one process. Open `http://127.0.0.1:8790/` for a
room index — every room on the server, linked to its own `/r/<id>`, with a
form to create a new one. Open a specific room directly at `/r/<id>`.

Rooms persist under `data/rooms/`, one file per room, and outlive the server
process: closing it and starting it again finds every room intact.

## Attach a Claude Code session

The plugin is the only thing that connects an agent to a room:

```bash
claude --plugin-dir .
```

`.mcp.json` points at `src/mcp.ts`, which speaks MCP over stdio and connects
to the room server as a client — it holds no document itself. The plugin's
`spec-room` binary, on `PATH` while the plugin is enabled, starts the room
server on demand if it isn't already running; run it before attaching a
session, or run `bun run src/server.ts` yourself.

Once attached, a session calls `room_list` to see what rooms exist,
`room_create` or `room_join` to attach to one, then `read`, `outline`,
`search`, `edit`, `append`, `insert`, `comments`, `reply`, and `resolve` to
work in it — the same tools regardless of which room is joined. `@claude` in
a comment notifies the session immediately; an untagged comment waits until
someone presses "send to claude" — this additionally needs the channels
research preview, and on Team/Enterprise an org admin must set
`channelsEnabled`; without it the notification is dropped silently and
everything else still works.

## Test

```bash
bun test
bun run src/smoke.ts
```

`smoke.ts` seeds a throwaway room, spawns the MCP server against it, and
drives the whole tool surface end to end.

## Deliberately not here

Auth, SSO, sharing and permissions, hosting and deployment. Local first, a
tunnel to demo. See `docs/superpowers/specs/2026-08-19-spec-room-design.md`
for the full design.
