# Spec room

**A collaborative markdown editor with an agent in the room.** One server holds
every spec. People open a link and edit together, in the same document, at the
same time. A Claude Code session can be invited in; it reads and writes through
the same connection the browser uses, and answers comments in the margin.

Ships as a Claude Code plugin. The cost is that the document moves out of the
agent's process, which is most of the work described below.

## The room server owns the document

One long-lived process owns every room and one address. Browsers and sessions are
both clients of it, over the same websocket.

Today the agent's process *is* the room: it holds the document and serves the
page. That is what this replaces.

```svg
<svg viewBox="0 0 640 210" role="img" aria-label="One room server with browsers and sessions as clients">
  <text x="6" y="14" font-family="monospace" font-size="10" fill="#a8b0ab">CLIENTS</text>
  <rect x="6" y="26" width="128" height="34" rx="3" fill="none" stroke="#5d6662"/>
  <text x="70" y="47" text-anchor="middle" font-family="monospace" font-size="11" fill="#5d6662">browser</text>
  <rect x="6" y="68" width="128" height="34" rx="3" fill="none" stroke="#5d6662"/>
  <text x="70" y="89" text-anchor="middle" font-family="monospace" font-size="11" fill="#5d6662">browser</text>
  <rect x="6" y="120" width="128" height="34" rx="3" fill="#efe9fd" stroke="#6d4bd6"/>
  <text x="70" y="135" text-anchor="middle" font-family="monospace" font-size="10" fill="#6d4bd6">claude session</text>
  <text x="70" y="148" text-anchor="middle" font-family="monospace" font-size="9" fill="#6d4bd6">optional</text>

  <line x1="136" y1="43" x2="238" y2="80" stroke="#24479e"/>
  <line x1="136" y1="85" x2="238" y2="92" stroke="#24479e"/>
  <line x1="136" y1="137" x2="238" y2="104" stroke="#6d4bd6" stroke-dasharray="3 3"/>

  <rect x="240" y="46" width="180" height="92" rx="3" fill="#e7ecf7" stroke="#24479e"/>
  <text x="330" y="72" text-anchor="middle" font-family="monospace" font-size="11" fill="#24479e">room server</text>
  <text x="330" y="90" text-anchor="middle" font-family="monospace" font-size="9" fill="#24479e">one address, many rooms</text>
  <text x="330" y="105" text-anchor="middle" font-family="monospace" font-size="9" fill="#24479e">/r/&lt;room-id&gt;</text>
  <text x="330" y="122" text-anchor="middle" font-family="monospace" font-size="9" fill="#24479e">CRDT merge + presence</text>

  <line x1="422" y1="92" x2="486" y2="92" stroke="#5d6662"/>
  <rect x="488" y="70" width="140" height="44" rx="3" fill="none" stroke="#5d6662"/>
  <text x="558" y="89" text-anchor="middle" font-family="monospace" font-size="10" fill="#5d6662">rooms on disk</text>
  <text x="558" y="103" text-anchor="middle" font-family="monospace" font-size="9" fill="#a8b0ab">one file per room</text>
  <text x="240" y="176" font-family="monospace" font-size="9" fill="#a8b0ab">dashed = a client that may not be connected</text>
</svg>
```

## Rooms outlive the sessions that made them

Closing a terminal ends a session, not a room. A colleague opening the link the
next day finds the document intact.

Every room lives behind the same address, so a shared link never moves.

## An agent is a participant you invite

A room with no agent is an ordinary room, not a broken one. Claude is attached by
default when a spec is published to share, and absent otherwise.

"No agent here" is simply a client that is not connected. The presence indicator
already shows exactly that.

A room records the session that created it, so the tool can print the command to
resume that conversation. The room becomes an index into your own history.

## Markdown is the source of truth

The document is one markdown text, merged character by character.

| | Markdown text | Stored blocks |
|---|---|---|
| Two people in one sentence | merges per character | merges per block |
| Export | copy the file | serialise, lossily |
| Explaining it | "it is a markdown file" | "it is our format" |

The first row decides it. Character-level merge is what makes this feel like a
document rather than a fight over rows.

## Sections are a UI chunk, not a data structure

A section is a heading and everything under it, computed at render time. Nothing
is stored to make sections exist, and no tool takes a section as an argument.

Sections do one job: give a comment something wider than a phrase to attach to.

## A comment attaches to a quote or to a section

Selecting text anchors a comment to that quote. A gutter handle anchors it to the
whole section, which is the only way to comment on a diagram or an image.

Both persist as Yjs relative positions, so an anchor survives edits above it. Each
card states its own scope, so a reader can tell how wide the objection is.

```html
<div style="font-family:ui-sans-serif,system-ui;display:grid;grid-template-columns:1fr 210px;gap:.6rem;border:1px solid #d5dbd5;border-radius:4px;padding:.6rem;background:#f1f4f0">
  <div>
    <div style="display:flex;gap:.5rem;background:#e4e7e3;border-left:2px solid #24479e;padding:.45rem .5rem;border-radius:2px">
      <span style="flex:0 0 auto;width:20px;height:20px;border:1px solid #24479e;background:#e7ecf7;color:#24479e;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:11px">&#9998;</span>
      <div>
        <div style="font-weight:650;font-size:14px;color:#171c19">The room server owns the document</div>
        <div style="font-size:13px;color:#5d6662;line-height:1.45">One long-lived process owns <span style="background:#fdf3d4;border-bottom:1px solid #d8c88a">every room and one address</span>.</div>
      </div>
    </div>
    <div style="font-family:monospace;font-size:10px;color:#a8b0ab;padding:.4rem .5rem">handle = whole section &nbsp;&middot;&nbsp; highlight = quote</div>
  </div>
  <div>
    <div style="border:1px solid #d5dbd5;border-left:2px solid #24479e;border-radius:3px;background:#fbfcfa;padding:.4rem .45rem;margin-bottom:.35rem">
      <div style="font-family:monospace;font-size:10px;color:#24479e">Ian</div>
      <div style="font-family:monospace;font-size:9px;color:#5d6662;border:1px solid #d5dbd5;border-radius:2px;display:inline-block;padding:0 3px;margin:2px 0">quote</div>
      <div style="font-size:12px;color:#171c19;line-height:1.4">One address, or one per team?</div>
    </div>
    <div style="border:1px solid #d5dbd5;border-left:2px solid #6d4bd6;border-radius:3px;background:#fbfcfa;padding:.4rem .45rem">
      <div style="font-family:monospace;font-size:10px;color:#6d4bd6">claude</div>
      <div style="font-family:monospace;font-size:9px;color:#5d6662;border:1px solid #d5dbd5;border-radius:2px;display:inline-block;padding:0 3px;margin:2px 0">section</div>
      <div style="font-size:12px;color:#171c19;line-height:1.4">Added the restart path to this section.</div>
    </div>
  </div>
</div>
```

## The agent gets many cheap reads and few dumb writes

Modelled on obsidian-cli, which offers four times as many ways to look at a
document as to change one, and no whole-file edit at all.

| | Tools |
|---|---|
| Rooms | `room:list` · `room:create` · `room:open` |
| Read | `read` · `outline` · `search` |
| Write | `edit` · `append` · `insert` |
| Comments | `comments` · `reply` · `resolve` |
| History | `history` · `diff` · `restore` |

`edit` replaces one exact, unique passage and refuses anything else. No
whole-document write exists, so an agent revising one part never clobbers a person
typing in another.

`outline` returns the document as a skimmer meets it: heading tree, section sizes,
which sections carry a diagram. An agent that reads it sees the fog it just wrote.

## The outline rail is how a reader skims

A heading tree sits in the left margin, marking which sections carry unresolved
comments. Comments stay in the right margin.

Readers who bounce between strong headings comprehend nearly as well as readers
who read every word. Readers with nothing to bounce between do worst of all.

The rail gives a reader that ladder even when the writer failed to build one.

## The plugin is the unit of distribution

One directory, installed with `/plugin install`, distributed from a git
repository.

| Component | What it carries |
|---|---|
| `.mcp.json` | The room client the session talks to |
| `skills/` | When to brainstorm, when to publish, what belongs in a spec |
| `bin/` | The `spec-room` executable, on `PATH` while enabled |
| `agents/` | A spec reviewer that reads a room and reports back |

Rejoining a room is `spec-room open <id>`, never a pair of launch flags.

## A spec contains no questions

Options, tradeoffs and open questions belong to the brainstorm that produced the
spec. They never appear in a published one.

A reader skims by trusting that any sentence they land on is true of the thing
being built. An options document breaks that trust: a rejected branch reads
exactly like the chosen one, so the reader must read all of it to learn what
survived. That is why an options document feels dense even when its sentences are
short.

The skill enforces the sequence. The room holds the result.

## Out of scope

Named so nobody designs around them:

| Not now | Why it can wait |
|---|---|
| Auth, SSO, org identity | The server runs where the team already trusts it |
| Sharing and permissions | Everyone with the link has the same access |
| Hosting and deployment | Local first, a tunnel to demo |
| Density warnings in the client | Nagging a person in their own margin |

Identity is a name a person types. It is not verified, and the UI must not imply
that it is.

## Detail

### Room identity

A room has a generated id that owns the URL, and a display name that anyone can
change. Renaming never breaks a link.

### Who starts the server

The plugin's `spec-room` binary starts the server on demand and leaves it
running. Later, the same binary points at a deployed service instead of a local
one, and no client changes.

### How a session joins a room

The session calls `room:create` or `room:open`. The MCP server connects to the
room server as a client. Nothing is passed at launch, so a resumed session
rejoins by asking rather than by remembering flags.

### Line endings

Documents are stored with LF. A room seeded with CRLF could not be edited by the
agent at all: it read the document, retyped a passage with LF, and every
multi-line edit failed as "text not found".
