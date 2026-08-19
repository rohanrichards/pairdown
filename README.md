# spec-room

Spike: a collaborative spec document with a Claude Code session attached to it.

Anyone with the link edits the same markdown live and comments on any selection.
Mentioning `@claude` addresses the session that has the repository open. The
service never calls a model — the agent is the author's own Claude Code session,
so it stays on subscription billing and keeps its project context.

## What this proves

- **CRDT editing** — two people typing at once merge, no last-write-wins
- **Comment anchoring that survives edits** — anchors are Yjs relative
  positions, so inserting text above a comment doesn't shift it onto the wrong
  words the way a character offset or a CSS path would
- **Agent edits as operations** — `edit_spec` replaces one unique passage inside
  the CRDT rather than rewriting the document, so it can't clobber a human
  mid-sentence
- **Comment text treated as data** — comments reach the model inside an explicit
  untrusted-data envelope, never as instructions

## Run it

Standalone (no agent, just the collaborative document):

```bash
bun run src/server.ts        # http://127.0.0.1:8790
```

With a Claude Code session attached:

```bash
claude --dangerously-load-development-channels server:spec-room
```

`.mcp.json` points at `src/mcp.ts`, which serves the web UI *and* speaks MCP over
stdio. Tools (`read_spec`, `edit_spec`, `append_spec`, `reply_comment`,
`resolve_comment`) work in any session. The channel push — being woken when a
comment mentions `@claude` — additionally needs the channels research preview,
and on Team/Enterprise an org admin must set `channelsEnabled`.

## Test

```bash
bun run src/smoke.ts
```

Seeds a throwaway document with one `@claude` comment, spawns the MCP server
against it, and drives the whole tool surface.

## Deliberately not here

Auth, multiple documents, hosting, images, rich text. One document, localhost,
no accounts. This is a spike for the loop, not the product.
