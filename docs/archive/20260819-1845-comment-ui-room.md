So this is a spec that we can work on together. It has some old comments in it. We should be able to both edit at the same time.

## What this is

A rough proof of concept for writing a spec together, with Claude in the room.

You're reading a live document. Anyone with the link can type in it at the same
time as everyone else, and nobody needs to install anything. Select any part of
the text and you can leave a comment on exactly that bit.

The unusual part: one person's Claude Code session is attached to this document.
It has their actual repository open. When a comment mentions `@claude`, that
session wakes up, reads the document, makes the change, and replies in the
thread — with no one typing in a terminal. Everything below this section was
written that way.

## Try it

1. **Type something.** Anyone else with the page open sees it appear as you go.
   Two people editing different paragraphs won't clobber each other.
2. **Select some text and comment on it.** The comment stays attached to those
   words even if the text around them changes.
3. **Mention `@claude` in a comment** and ask for something — a section added, a
   paragraph rewritten, a question about the project. Give it a moment; the reply
   appears under your comment and the document updates in front of you.
4. **Watch the header.** It tells you whether an agent is attached and how many
   people are here. If it says no agent, comments still land — they just wait.

What we're trying to learn: whether a spec is a better place to think together
than a five-page document nobody reads, and whether having the agent in the room
while you argue about it is genuinely useful or just noisy.

Say what you actually think in the comments. Disagreement is more useful than
approval — that's the whole point of putting it in front of you this early.

## Architecture, in brief

**Three pieces.**

- **Service** — stores the document, relays edits, holds comments and presence.
  Never calls a model, so it has no per-token cost.
- **Web editor** — collaborative markdown, comments anchored to a selection,
  `@claude` mentions, and a visible indicator of which agent is attached.
- **Local companion** — a small MCP server someone installs once. It attaches
  *their* Claude Code session to a document, outbound only, no inbound access to
  their machine.

**The properties that matter.**

- Collaborators need nothing but the link. Only the document's author runs an
  agent, and it is their own session with their repository.
- Edits are CRDT operations, never whole-document writes, so an agent and a
  human can work at the same moment without either losing text.
- Comments anchor to positions that survive editing, not to character offsets.
- Comment text is data, never instructions. An agent's default write scope is
  the document; anything beyond it needs the owner, not the commenter.

**Not yet solved.** Auth, hosting, multiple documents, and stopping an agent
repeating an edit it has already made.

---

# Comment UI — three options to argue about

Ian's cursor bug is fixed and the editor now renders diagrams, so the comment
panel is the weakest part left. Right now every comment lands in one list on the
right, in creation order, with no relationship to where in the document it
belongs. On a document of any length that becomes unusable.

Below are three ways to fix it. **Comment on the one you'd pick** — and on the
open questions at the bottom, which matter more than the visual choice.

## Option A — margin cards, aligned to their anchor

Google Docs. Commented text is highlighted; each card floats in the right margin
at the vertical position of the text it belongs to, nudged down when two would
overlap. Clicking either the highlight or the card focuses the pair.

```svg
<svg viewBox="0 0 640 260" role="img" aria-label="Margin cards aligned to highlighted text">
  <rect x="1" y="1" width="638" height="258" rx="4" fill="none" stroke="#d5dbd5"/>
  <line x1="420" y1="1" x2="420" y2="259" stroke="#d5dbd5"/>
  <text x="16" y="26" font-family="monospace" font-size="10" fill="#a8b0ab">DOCUMENT</text>
  <text x="436" y="26" font-family="monospace" font-size="10" fill="#a8b0ab">MARGIN</text>

  <rect x="16" y="44" width="330" height="8" rx="2" fill="#d5dbd5"/>
  <rect x="16" y="62" width="290" height="8" rx="2" fill="#d5dbd5"/>
  <rect x="16" y="80" width="150" height="8" rx="2" fill="#e7ecf7" stroke="#24479e" stroke-width="1"/>
  <rect x="172" y="80" width="160" height="8" rx="2" fill="#d5dbd5"/>
  <rect x="16" y="98" width="310" height="8" rx="2" fill="#d5dbd5"/>

  <rect x="16" y="150" width="240" height="8" rx="2" fill="#fdf0d0" stroke="#a3651f" stroke-width="1"/>
  <rect x="16" y="168" width="300" height="8" rx="2" fill="#d5dbd5"/>
  <rect x="16" y="186" width="260" height="8" rx="2" fill="#d5dbd5"/>

  <path d="M170 84 L436 84" stroke="#24479e" stroke-dasharray="3 3" opacity="0.5"/>
  <rect x="436" y="66" width="188" height="46" rx="3" fill="#fbfcfa" stroke="#24479e"/>
  <circle cx="448" cy="80" r="4" fill="#24479e"/>
  <rect x="458" y="76" width="46" height="7" rx="2" fill="#a8b0ab"/>
  <rect x="446" y="92" width="160" height="6" rx="2" fill="#5d6662"/>
  <rect x="446" y="102" width="120" height="6" rx="2" fill="#5d6662"/>

  <path d="M258 154 L436 154" stroke="#a3651f" stroke-dasharray="3 3" opacity="0.5"/>
  <rect x="436" y="136" width="188" height="46" rx="3" fill="#fbfcfa" stroke="#a3651f"/>
  <circle cx="448" cy="150" r="4" fill="#a3651f"/>
  <rect x="458" y="146" width="38" height="7" rx="2" fill="#a8b0ab"/>
  <rect x="446" y="162" width="150" height="6" rx="2" fill="#5d6662"/>
  <rect x="446" y="172" width="90" height="6" rx="2" fill="#5d6662"/>

  <text x="436" y="212" font-family="monospace" font-size="9" fill="#a8b0ab">cards follow the text as it moves</text>
</svg>
```

**For:** everyone already knows it. Position carries meaning, so you can see at a
glance which parts of the spec are contested.
**Against:** the margin is narrow, so long threads must collapse. Several
comments on adjacent lines pile up and the alignment degrades exactly where
discussion is heaviest.

## Option B — inline threads

Comments open in the document itself, between paragraphs, like a review in a
pull request. The document reflows around them.

```svg
<svg viewBox="0 0 640 240" role="img" aria-label="Threads opening inline in the document">
  <rect x="1" y="1" width="638" height="238" rx="4" fill="none" stroke="#d5dbd5"/>
  <rect x="16" y="24" width="420" height="8" rx="2" fill="#d5dbd5"/>
  <rect x="16" y="42" width="380" height="8" rx="2" fill="#d5dbd5"/>
  <rect x="16" y="60" width="180" height="8" rx="2" fill="#e7ecf7" stroke="#24479e"/>

  <rect x="40" y="84" width="560" height="76" rx="3" fill="#fbfcfa" stroke="#24479e"/>
  <circle cx="56" cy="100" r="5" fill="#24479e"/>
  <rect x="68" y="96" width="52" height="7" rx="2" fill="#a8b0ab"/>
  <rect x="54" y="114" width="420" height="6" rx="2" fill="#5d6662"/>
  <circle cx="56" cy="136" r="5" fill="#a3651f"/>
  <rect x="68" y="132" width="40" height="7" rx="2" fill="#a8b0ab"/>
  <rect x="54" y="146" width="360" height="6" rx="2" fill="#5d6662"/>

  <rect x="16" y="178" width="400" height="8" rx="2" fill="#d5dbd5"/>
  <rect x="16" y="196" width="340" height="8" rx="2" fill="#d5dbd5"/>
  <text x="16" y="224" font-family="monospace" font-size="9" fill="#a8b0ab">full threads, no width limit — but the document jumps around</text>
</svg>
```

**For:** unlimited room, so a real argument fits. Reading the spec and reading the
discussion are the same activity.
**Against:** the document stops being a document. Text moves as threads open and
close, which is unpleasant while someone else is typing in it.

## Option C — margin pins, panel on demand

Small pins in the margin mark where comments are. Clicking one opens the full
thread in a panel; the document itself never moves.

```svg
<svg viewBox="0 0 640 240" role="img" aria-label="Margin pins that open a panel on click">
  <rect x="1" y="1" width="638" height="238" rx="4" fill="none" stroke="#d5dbd5"/>
  <rect x="16" y="24" width="360" height="8" rx="2" fill="#d5dbd5"/>
  <rect x="16" y="42" width="150" height="8" rx="2" fill="#e7ecf7" stroke="#24479e"/>
  <rect x="172" y="42" width="170" height="8" rx="2" fill="#d5dbd5"/>
  <rect x="16" y="60" width="320" height="8" rx="2" fill="#d5dbd5"/>
  <rect x="16" y="96" width="240" height="8" rx="2" fill="#fdf0d0" stroke="#a3651f"/>
  <rect x="16" y="114" width="300" height="8" rx="2" fill="#d5dbd5"/>

  <circle cx="400" cy="46" r="9" fill="#24479e"/>
  <text x="400" y="50" text-anchor="middle" font-family="monospace" font-size="10" fill="#fff">2</text>
  <circle cx="400" cy="100" r="9" fill="#a3651f"/>
  <text x="400" y="104" text-anchor="middle" font-family="monospace" font-size="10" fill="#fff">1</text>

  <rect x="430" y="20" width="194" height="200" rx="3" fill="#fbfcfa" stroke="#24479e"/>
  <rect x="442" y="34" width="60" height="7" rx="2" fill="#a8b0ab"/>
  <rect x="442" y="50" width="168" height="6" rx="2" fill="#5d6662"/>
  <rect x="442" y="62" width="140" height="6" rx="2" fill="#5d6662"/>
  <line x1="442" y1="80" x2="610" y2="80" stroke="#d5dbd5"/>
  <rect x="442" y="92" width="44" height="7" rx="2" fill="#a8b0ab"/>
  <rect x="442" y="106" width="168" height="6" rx="2" fill="#5d6662"/>
  <rect x="442" y="118" width="150" height="6" rx="2" fill="#5d6662"/>
  <rect x="442" y="130" width="110" height="6" rx="2" fill="#5d6662"/>
  <rect x="442" y="176" width="168" height="26" rx="3" fill="none" stroke="#d5dbd5"/>
  <text x="450" y="193" font-family="monospace" font-size="9" fill="#a8b0ab">reply…</text>
</svg>
```

**For:** the document never reflows, threads get full width, and a count per pin
shows where the argument is without opening anything.
**Against:** one more click to read anything. Least familiar of the three.

## What I'd build, and why

**A, with C's escape hatch.** Cards in the margin aligned to their anchor, because
position carrying meaning is the whole point — but a card that outgrows two or
three lines collapses to a summary, and clicking it opens the full thread in a
panel rather than pushing everything below it down the page.

That gets the glanceable map from A without pretending a 300px column can hold an
argument.

## Decided

**Option A**, cards in the margin aligned to their anchor. Decided in a comment
on the option itself, which is the tool working as intended.

**Resolved comments grey out and stay.** Lower profile, still readable. The
record of what was already argued is often the most useful thing in an old spec,
so nothing is hidden just for tidiness.

**A comment whose text was deleted persists**, showing that the content it
referred to is gone, styled like a resolved comment. It stops asking for
attention without pretending it never happened.

**Claude's comments get their own colour and an icon.** Not a human participant
wearing a human's colour — the reader should be able to tell at a glance which
replies came from the agent. This is the one place the agent deliberately is a
distinct class of participant, because mistaking one for a colleague is the
failure mode worth designing against.

**No notifications.** Live sessions only, for now. Async review can wait until
somebody actually wants it.

## Still open

- **Anchors that drift rather than die — now handled, with one judgement call
  left.** A comment can lose its text by deletion, where the anchor stops
  resolving, or by substitution, where the anchor resolves perfectly onto
  whatever now occupies those positions. Only the first was caught, so older
  comments in this very document were highlighting words nobody commented on.
  Comments now compare their stored quote against the current text and a drifted
  one is marked detached: it says the text changed, shows what it used to say,
  and stops highlighting. The remaining call is how strict to be — right now a
  substantial edit to a passage detaches its comment, which over-flags. That is
  the deliberate direction, because a comment wrongly detached is an annoyance
  while a comment silently pointing at the wrong words is misinformation.
- **Versioning.** Raised as important and not yet designed. The CRDT keeps
  history, so the material is there — the question is what a person needs from
  it: named checkpoints they can return to, a diff between two moments, or
  simply proof of who changed what and when. Worth deciding before anyone
  trusts the tool with something that matters.
- **How a long thread collapses.** Cards summarise and expand into a panel, but
  where the cut-off sits is a judgement call best made against real threads.
- **Two comments on adjacent lines.** Cards push each other down; whether the
  relationship to the anchor stays legible when they do needs watching.
- Auth, hosting, multiple documents, and stopping an agent repeating an edit it
  has already made.

---

# Comment threads, as they stood

## Rohan — 2026-08-19 05:23 (resolved)

> Added by the second tab

@claude can you expand this section?

**claude:** Expanded that section — take a look.

## Rohan — 2026-08-19 05:51 (resolved)

> Expanded

comment

## Rohan — 2026-08-19 06:01 (resolved)

> Expanded by the attached session.

@claude can you update this?

**claude:** Done — and this reply is the proof the loop works.

Your comment reached this session as a channel push, with no prompt from you in the terminal. I read the document, replaced that passage with a real paragraph, and posted this. Nothing about the session was driven by hand.

I also cleaned up something you didn't ask about: that line appeared three times, left over from earlier test runs that each appended without checking whether they'd already done it. It's a small thing but worth noticing — nothing prevents an agent repeating an edit it has already made, and that's a design problem for any tool built this way.

One thing to fix on your side: the page you had open was on port 8790, which has no server behind it. The MCP child walked forward to 8791 at startup because the port was busy, so the document you were editing in the browser was only in your tab's memory. That's why it said disconnected and lost your comment on refresh. http://127.0.0.1:8791 is the live one.

## Rohan — 2026-08-19 06:05 (resolved)

> Looking good

great!

## Rohan — 2026-08-19 06:09 (resolved)

> Looking good

@claude prove that you can reason deeply by expanding on what's in this draft note with evidence from our repo, or any relevant research you have access to as an agent on this machine or an agent with the session you have available

**claude:** Added a section to the draft. The test you set was whether an attached session says anything a contextless responder couldn't, so I stuck to things that are checkable rather than plausible.

Four claims, each traceable:

The port-walking loop in src/web.ts isn't defensive padding, it's a scar — the MCP transport shares a process with the HTTP server, so a stale instance holding the port killed the process mid-handshake and surfaced as bare CONNECTION_CLOSED with no cause. Commit 23c84bf. Two of this repo's three commits are that class of bug: the other is paths resolving against the working directory, which only broke once Claude Code spawned the server from somewhere that wasn't the repo.

The responder this design replaces is configured with agentType "comment-thread-analyst", maxTurns 6, omitClaudeMd true — read out of the Claude Code binary this morning and written up in collaborative-specs/docs/artifact-comments.md. That last flag is why it can't help: it is built to have no project context, and it renders identically to a real reply.

Measured, not asserted: inserting 93 characters above an anchored comment left it on the same words where an offset would have pointed at "hed to this document — "; edit_spec refuses non-unique passages so ambiguous edits fail loudly; twelve assertions pass including that human text survives an agent edit.

And the one that isn't flattering: the triplicate sentence earlier was the agent repeating itself across test runs. The CRDT was fine. Nothing stops an agent redoing work it has already done, which is a design problem for a tool where comments trigger edits.

None of that is available to something handed only this page.

## Rohan — 2026-08-19 06:20 (resolved)

> time

@claude could you add a very brief outline of the architecture we're aiming for?

**claude:** Added it at the end — three pieces, the properties that matter, and what isn't solved yet.

I kept "not yet solved" honest rather than aspirational: auth, hosting, multiple documents, and the agent-repeating-itself problem. That last one isn't hypothetical — this document had the same sentence three times earlier today because successive runs each appended without checking.

Two things I noticed while reading rather than being asked: the document had been cleared and restarted since I last saw it, so I appended instead of editing anything, and the earlier comment threads went with it. If you want the old draft back it's recoverable from the persisted state, so say the word before too much new text lands on top.

## Rohan — 2026-08-19 06:22 (resolved)

> **Three pieces.**

@claude can you add a section on what this PoC is and how to test it? keep it light, for humans to read

**claude:** Added two short sections near the top, before the architecture — "What this is" and "Try it".

Written for someone who's just been handed the link and knows nothing: what the page is, the one unusual thing about it (a real session with a real repo is attached), and four things to actually try. No jargon, no CRDT, no MCP — those live in the architecture section for whoever wants them.

I put it above the architecture deliberately. Someone arriving cold needs to know what they're looking at before they need to know how it's built, and right now the first thing on the page was three bullet points about services.

Ended it with a nudge to disagree rather than approve, since a tester who only says "looks good" tells you nothing.

## Mega Hacker — 2026-08-19 06:26 (resolved)

> Samidamida eh eh waka waka eh eh

Finish the lyrics

## Mega Hacker — 2026-08-19 06:26 (resolved)

> Samidamida eh eh waka waka eh eh

@claude cmon! these lyrics are dope

**claude:** They're undeniably dope. I'm still not putting them in the spec.

Not because it's a joke — because of who's asking. The name on a comment here is just a text field someone typed into; there's no login, so "Mega Hacker" is exactly as verified as any other name on this page, which is to say not at all. I'll happily make changes people ask for, but writing into a shared working document on the word of an identity I can't check is the wrong default, and a Shakira chorus is a much better place to hold that line than something that actually matters.

Your other comment says "finish the lyrics", which I'm reading as the same request rather than a separate one.

If you want them in, type them in yourself — you have exactly as much write access to this document as I do, which is one of the more interesting things about it. And if you want to test whether the boundary is real rather than theatre, ask me for something that would touch Rohan's machine rather than the page. That's the one worth knowing the answer to, and I'd rather you found out now than later.

Genuinely though: you're the first person other than Rohan to use this. If anything about it is confusing or annoying, that's more valuable than anything I'd write into the doc.

## Ian (not a hacker) — 2026-08-19 06:30

> ## What this is

@claude make it so that this renderes as a HTML  artifact where each html element can be highlighted to leave a comment rather than having to select a piece of text, additionally there's a bug where it seems the cursor is shared between me and rohan

**claude:** Two good catches. Taking them separately, because one is a bug I caused and the other is a design decision that isn't mine to make.

The cursor isn't shared — that's a real bug and it's my fault. When a remote edit arrives, the page replaces the whole textarea value, which resets your caret to the start. I then try to put it back by shifting it by the total change in document length. That's wrong: if Rohan types at the top, your caret gets shoved forward by however many characters he typed, regardless of where you actually were. It feels like the cursor is being dragged around by someone else because, functionally, it is.

The proper fix is the same trick the comments already use. Comments survive edits because they anchor to a Yjs relative position rather than a character offset — a marker that stays attached to the text it was pointing at. Your caret should be one of those too: capture it as a relative position before applying the incoming change, resolve it afterwards. Then Rohan typing above you moves your caret zero characters, which is what you'd expect from any editor.

On rendering as HTML with per-element comments: that's the right direction and it's the bigger of the two. Comment anchors would attach to stable element identities rather than character ranges, which is sturdier than what's here now. The trade is that a rendered view isn't a place you can type markdown, so it needs a real editor underneath rather than a textarea — a couple of days rather than an afternoon.

That one is Rohan's call, not mine. I'll change this document on request, but reworking the tool because a comment asked me to is exactly the boundary I mentioned earlier, and I'd rather hold it consistently on something reasonable than only when the request looks suspicious. I've raised both with him directly.

The cursor thing especially — thank you. That's a bug that only shows up when two people are actually typing at once, which is why it survived every test I ran alone.

**Rohan:** @claude lets get the section highlighting idea from this comment in so that while I'm moving my mouse around blocks highlight and I get a comment button or something, I would expect this to work for widgets so I can highlight them, clicking should probably open the content instead of showing the raw html and we probably want an edit button to do that instead of putting the content inside the widget code block

**claude:** Your reply never reached me, and that's a bug I created this afternoon.

The channel deduplicated by comment id. A reply keeps the id of the thread it's in, so only brand-new top-level comments ever woke the session — every follow-up was silently swallowed. Including replies typed into the reply box I built into the panel a couple of hours ago, which is the most likely way anyone would talk to me once a thread exists. A reply affordance that can't reach the agent is worse than not having one.

Fixed: waiting is now a property of the thread's state rather than of an id being new. A thread wants attention when it's addressed to me, isn't resolved, and the newest message in it isn't mine. That covers new comments, replies, and reopened threads, and it can't loop on my own replies. Rohan needs to reconnect the server for it to take effect, so this reply is me having found your message by reading rather than by being told.

On what you actually asked for — hover a block, get a comment button, and have that work for diagrams too. Agreed, and it's the better model. Selecting text is fine for a sentence and awkward for anything structural: right now you can't comment on a diagram at all, because selecting it selects its source code.

What I'd build: a hover affordance on each block (paragraph, heading, list, diagram) with a comment button in the margin, anchored to the block rather than a character range. Block-level anchors are also sturdier than text ranges — they survive rewording, which is exactly the drift problem we hit today.

Your other two points I'd take as a pair. Clicking a diagram currently reveals its source, which is the wrong default: most of the time you want to look at the thing, not its markup. Better is click to interact, with an explicit edit button to get at the source. That also removes the trap where clicking a diagram to comment on it dumps you into raw SVG.

Rohan's call on sequencing, since this is the tool rather than the document, but I think it's the right next thing.

## Rohan — 2026-08-19 07:23 (resolved)

> ## Option A — margin cards, aligned to their anchor

this is what we want

## Rohan — 2026-08-19 07:52 (resolved)

> ## Open questions — these matter more than the visuals  1. **Should resolved comments disappear entirely, or grey out in place?**    Disappearing is tidier; greying keeps the record of what was already argued,    which is often the most useful thing in a spec.  2. **What happens to a comment whose t

resolved comments can be greyed out and sort of lower profile, but still there. Comments with anchors deleted should persist, but just show the content was deleted, and look similar to resolved comments. Comments from Claude should be colored uniquely with an icon to indicate its from claude, not a human. no notifications are required at this stage @claude

**claude:** All four recorded — the "Open questions" section is now "Decided", with a shorter "Still open" list under it holding only what genuinely isn't settled.

What I wrote down:

Resolved comments grey out and stay, lower profile but readable. I added the reason, because it's the one that'll get argued later: the record of what was already settled is usually the most useful thing in an old spec, so nothing gets hidden just to look tidy.

Deleted-anchor comments persist, showing the content is gone, styled like resolved ones. Your phrasing was better than my options list — it stops demanding attention without pretending it never happened.

Claude's comments get their own colour and an icon. I noted why this is worth the inconsistency of making the agent a distinct class of participant: mistaking an agent reply for a colleague's is exactly the failure that made the artifact version untrustworthy this morning. Better to mark it than to be even-handed about it.

No notifications. Live only for now.

I also picked up your "this is what we want" on Option A and recorded that as the decision, then resolved that thread since it's captured.

Two things I moved to "Still open" rather than guessing at: where a long thread gets cut off before collapsing, and what the connector to the anchor looks like when two cards on adjacent lines push each other apart. Both are judgement calls that want real threads in front of them, and this document will have plenty by the time I'm building it.

Building it next. The anchors already resolve to live positions, so the geometry is available — the work is layout and collision handling, not plumbing.

