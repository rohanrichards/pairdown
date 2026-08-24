---
name: writing-specs
description: Use when writing or editing a spec inside a Pairdown room — a document a team will read without you in the room. Covers where to think out loud versus what belongs in the document, and the rules that keep the document skimmable.
---

# Writing specs people will actually read

A Pairdown document is read by people who were not in the conversation that
produced it. Nobody is there to explain a sentence that doesn't land. These
rules exist to make the document work without you present.

## Brainstorm in the terminal, never in the room

Work out options, tradeoffs, and open questions in this conversation first.
The room is not scratch space — it's the read surface other people trust.

A spec asserts. It never asks. Options, "for and against", and open questions
belong in the brainstorm that produced the spec, not in the document itself.
A rejected branch reads exactly like a chosen one to a skimming reader, so an
options document breaks the trust the whole format depends on.

Publish to the room only once the questions are answered. If something is
still genuinely undecided, it isn't ready to go in yet — keep working it out
before you `edit` or `append`.

## The rules, and why each one exists

These are instructions for you as the writer. A reader of the finished spec
never sees them — they see a document that happens to be easy to skim.

| Rule | Threshold | Why |
|---|---|---|
| No options or open questions | zero | A rejected branch reads exactly like a chosen one, so skimming breaks |
| State the answer early | by word 100 | Most people read one sentence, skim the next, then stop |
| Headings are claims, not labels | one per 150 words | Heading-to-heading scanning comprehends nearly as well as reading every word |
| Break up prose | under 4 lines | Long runs collapse a reader into the worst scanning pattern measured |
| Two dimensions means a table | always | Prose makes the reader rebuild the table in their head |
| One diagram per structural idea | always | Diagram the system, never the argument |
| Sentences stay short | under 25 words | Every clause is held in working memory until the sentence ends |

The research behind each rule — the reading studies, not just the rule — is in
`docs/spec-style.md`. Read it if a threshold above seems arbitrary.

## Before you publish

Check the draft against the table above. If a section has no heading in the
last 150 words, split it. If a paragraph runs past four lines, break it with a
list, a table, or a diagram. If you're still weighing options anywhere in the
text, that section isn't done — go back to the brainstorm.

## Diagrams

Show it rather than describe it, but only when the picture does work the prose
cannot. A diagram wins because information is indexed by location, so the reader
traverses instead of searching — that is the only reason to draw one.

| Rule | Threshold | Why |
|---|---|---|
| It answers a question the prose made the reader hold in their head | at least one | That is the whole advantage: location-indexed information makes inference cheap |
| Decorative graphics | zero | They make a document better liked and no better understood, and they compete for the attention the content needs |
| Ideas per diagram | one | If naming it needs an "and", it is two diagrams |
| Legends | zero | A legend puts the mapping back into working memory, which is the cost the diagram was meant to remove |
| Magnitude by area, angle or colour | never | Position is read up to 2.5x more accurately; area is worst. Colour separates categories, it does not carry size |
| Explaining what the audience already knows | never | Scaffolding that helps a novice is redundant load for someone who has the schema |
| Text positioned by hand in SVG | never | You cannot measure what the browser renders, so labels clip. HTML for text, SVG for shapes |
| Works in light and dark | always | Take colours from the palette tokens, never literals |

The research behind each is in `docs/spec-style.md`.
