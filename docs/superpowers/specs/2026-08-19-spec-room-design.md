# Spec room

**A collaborative markdown editor with an agent in the room.** One server holds
every spec. People open a link and edit together, in the same document, at the
same time. A Claude Code session can be invited in; it reads and writes through
the same connection the browser uses, and answers comments in the margin.

It works in a browser with nothing installed. The Claude Code plugin is how a
session joins a room, and is optional. The cost of all this is that the document
moves out of the agent's process, which is most of the work described below.

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

The server also answers `/` with a room index: every room on the server,
each linked to its `/r/<id>`, and a form to create a new one. The editor
itself lives only at `/r/<id>` — it has nothing to connect to at `/`. The
index is how a person reaches or creates a room without the CLI at all.

## An agent is a participant you invite

A room with no agent is an ordinary room, not a broken one. Claude is attached by
default when a spec is published to share, and absent otherwise.

"No agent here" is simply a client that is not connected. The companion publishes
its own state on the awareness channel, under an `agent` field carrying a `busy`
flag; the browser derives the presence indicator from that, and the server never
broadcasts presence of its own.

## Markdown is the source of truth

The document is one markdown text, merged character by character.

| | Markdown text | Stored blocks |
|---|---|---|
| Two people in one sentence | merges per character | merges per block |
| Export | copy the file | serialise, lossily |
| Explaining it | "it is a markdown file" | "it is our format" |

The first row decides it. Character-level merge is what makes this feel like a
document rather than a fight over rows.

## A section is one block

A section is a single block of the document: a heading, a paragraph, a list, a
table, a diagram, an image. One block, one section. This is the unit artifacts
use, and it reads as obvious because the boundary is already visible.

Blocks are computed at render time. Nothing is stored to make them exist, and no
tool takes one as an argument.

Sections exist to make commenting on a block easy. Hovering one reveals a
toolbar. For now that toolbar holds a comment button and nothing else.

Text is never gated behind an edit button. Click into it and type.

## A comment attaches to a quote or to a section

Selecting text anchors a comment to that quote. Hovering a block reveals a comment
button, which anchors to the whole block. That is the only way to comment on a
diagram or an image, because there is no text in one to select.

Both persist as Yjs relative positions, so an anchor survives edits above it. Each
card states its own scope, so a reader can tell how wide the objection is.

```html
<style>
  .wrap { display:grid; grid-template-columns:minmax(0,1fr) 210px; gap:.55rem .8rem; align-items:start }
  .lbl { font-family:var(--mono); font-size:.56rem; letter-spacing:.12em; color:var(--faint) }
  .blk { position:relative; border:1px solid transparent; border-radius:3px;
         padding:.55rem .7rem; line-height:1.5; color:var(--soft); transition:background .12s, border-color .12s }
  .blk:hover { background:var(--hl-dim); border-color:var(--rule) }
  .fig { background:var(--card); border-color:var(--rule); min-height:4.4rem;
         display:flex; align-items:center; justify-content:center; color:var(--faint) }
  .sel { background:var(--hl-open); border-bottom:1px solid var(--accent); padding:0 2px; color:var(--ink) }
  .btn { position:absolute; top:.35rem; right:.35rem; font-family:var(--mono); font-size:.58rem;
         color:var(--accent-ink); background:var(--accent-bg); border:1px solid var(--accent);
         border-radius:3px; padding:.12rem .38rem; opacity:0; transition:opacity .12s }
  .blk:hover .btn { opacity:1 }
  .card { border:1px solid var(--rule); border-left:2px solid var(--accent); border-radius:3px;
          background:var(--card); padding:.4rem .5rem }
  .who { font-family:var(--mono); font-size:.6rem; color:var(--accent-ink) }
  .said { font-size:.76rem; line-height:1.4; color:var(--soft) }
  .foot { grid-column:1 / -1; font-family:var(--mono); font-size:.6rem; color:var(--faint); padding-top:.2rem }
</style>
<div class="wrap">
  <div class="lbl">DOCUMENT &mdash; hover a block</div>
  <div class="lbl">MARGIN</div>

  <div class="blk">
    a paragraph with <span class="sel">these words selected</span> in it
    <span class="btn">comment</span>
  </div>
  <div class="card">
    <div class="who">quote</div>
    <div class="said">anchored to the words</div>
  </div>

  <div class="blk fig">
    a diagram, with no text to select
    <span class="btn">comment</span>
  </div>
  <div class="card">
    <div class="who">block</div>
    <div class="said">anchored to the whole block</div>
  </div>

  <div class="foot">the button appears on hover, and is the only control a block shows</div>
</div>
```

## The agent gets many cheap reads and few dumb writes

Modelled on obsidian-cli, which offers four times as many ways to look at a
document as to change one, and no whole-file edit at all.

| | Tools |
|---|---|
| Rooms | `room_list` · `room_create` · `room_join` |
| Read | `read` · `outline` · `search` |
| Write | `edit` · `append` · `insert` |
| Comments | `comments` · `reply` · `resolve` |

Colons are not safe across every MCP client, so the tools are named with
underscores, not the `room:list` shorthand used earlier in this document's own
history.

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

## The plugin is only how an agent joins

The product is a web application. Rooms, editing, comments and sharing all work
in a browser with nothing installed.

The Claude Code plugin does exactly one thing: it connects a session to a room. A
team that never installs it still has a working spec tool, with no agent in it.

| Component | What it carries |
|---|---|
| `.mcp.json` | The room client a session talks to |
| `skills/` | How to write a spec, and when one is ready to publish |
| `bin/` | The `spec-room` executable, on `PATH` while enabled |

There is no `spec-room join <id>` command. Joining is something the session
does, by calling the `room_join` tool once attached — never a pair of launch
flags the plugin has to be started with.

## The skill teaches the agent to write for humans

These are instructions to the agent writing the spec. A reader never sees them.
They ship in the plugin's skill, because an agent that only has prose tools writes
prose, whatever a style guide says.

| Rule | Threshold | Why |
|---|---|---|
| No options or open questions | zero | A rejected branch reads exactly like a chosen one, so skimming breaks |
| State the answer early | by word 100 | Most people read one sentence, skim the next, then stop |
| Headings are claims, not labels | one per 150 words | Heading-to-heading scanning comprehends nearly as well as reading every word |
| Break up prose | under 4 lines | Long runs collapse a reader into the worst scanning pattern measured |
| Two dimensions means a table | always | Prose makes the reader rebuild the table in their head |
| One diagram per structural idea | always | Diagram the system, never the argument |
| Sentences stay short | under 25 words | Every clause is held in working memory until the sentence ends |

The research behind each rule is in `docs/spec-style.md`.

Length is a weapon against review. A document long enough to deter reading is a
document nobody objects to, which is not the same as a document nobody has
objections to.

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

The session calls `room_create` or `room_join`. The MCP server connects to the
room server as a client. Nothing is passed at launch, so a resumed session
rejoins by asking rather than by remembering flags.

### Line endings

Documents are stored with LF. A room seeded with CRLF could not be edited by the
agent at all: it read the document, retyped a passage with LF, and every
multi-line edit failed as "text not found".

---

## Comment threads at export

- **Rohan** on "A section is a heading and everything under it,"
  why? why would a section be a heading? they should be more like html blocks, like one heading is a section, one paragraph is a section, one highlighted text block is a section, one widget, etc. Look at how artifacts do it, that was intuitive
  - **claude**: Changed. A section is now one block — a heading, a paragraph, a list, a table, a diagram, an image. One block, one section, the way artifacts do it. The heading-plus-subtree definition is gone.
- **Rohan** on "Sections do one job: give a comment something wider than a p"
  no sections make it easier to add a comment to a block
  - **claude**: Reworded to your framing: sections exist to make commenting on a block easy. Hovering a block reveals a toolbar, and for now that toolbar holds a comment button and nothing else.
- **Rohan** on "```html"
  this diagram makes no sense, what is it showing? is this meant to be a mock? this isn't readable and demonstreates nothing, I also notice an edit button and the user should not need to click edit to start writing, they just click into the test. The section is used to bring up a toolbar or something and the button we need for now is just a comment button.
  - **claude**: You are right, it demonstrated nothing. Replaced with a plain SVG showing the two anchor scopes: selected words to a "quote" card, a whole diagram to a "block" card. On the edit button: there is no edit button and there will not be one — that pencil was my mistake in the mock. Click into text and type. The spec now says exactly that.
- **Rohan** on " Rooms | `room:list` · `room:create` · `room:open` |"
  join?
  - **claude**: Renamed to `room:join`. "Open" implied opening a file; a room is live and already exists, so joining is the honest verb. Updated in the tool table and in the detail section below.
  - **claude**: Correction to my earlier reply: I had the reasoning backwards. "Open" implied creating a new room, which is why a separate verb was needed. `room:create` already covers making one, so `room:join` now covers entering one that exists. The naming is unchanged, the explanation was wrong.
- **Rohan** on "## The plugin is the unit of distribution"
  the plugin is actually just how you connect your agent in, the entire tool works in the cloud and doesn't require the plugin at all
  - **claude**: Corrected, and it was a real error in the spec. That section now reads "The plugin is only how an agent joins" and states that the product is a web application — rooms, editing, comments and sharing all work in a browser with nothing installed. A team that never installs the plugin has a working spec tool with no agent in it.
- **Rohan** on "## A spec contains no questions
"
  this needs to be broader, about the general rules we discovered around spec writing and writing for humans, and should be based in research, this is part of the plugin, but its only relevant to the AGENT who's writing the spec or working with the human
  - **claude**: Broadened. It is now "The skill teaches the agent to write for humans" — a table of seven rules with thresholds and the reason each exists, drawn from the reading research (scanning patterns, front-loading, attention budget). Scoped explicitly as instructions to the agent, never anything a reader sees. Full research is in docs/spec-style.md.
