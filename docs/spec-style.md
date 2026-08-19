# How to write a spec people will actually read

A spec in spec-room has one job: let someone who was not in the design
conversation understand what is being built, in under two minutes, well enough
to disagree with it.

Everything below serves that. Rules have thresholds so they can be checked.

## 1. A spec asserts. It never asks.

No options. No "for and against". No open questions. No design conversation.

Those belong in the brainstorm that produced the spec. A reader skims by
trusting that any sentence they land on is true of the thing being built. An
options document breaks that trust: a rejected branch reads exactly like the
chosen one, so the reader must read everything to find out what survived.

If something is genuinely undecided, it is not in the spec yet.

## 2. The answer goes in the first 100 words.

Title states the change. Then a short block, above every heading: what this is,
what changes, what it costs. A reader who stops there should still be correct
about the shape of the work.

Most readers read the first sentence, skim the second, and stop. Write for that
reader, not the one who finishes.

## 3. A heading every 150 words, and headings are claims.

"Rooms outlive their sessions", not "Architecture". A skimmer reads only
headings; a heading that names a category tells them nothing.

Readers with strong frequent headings comprehend nearly as well as readers who
read every word. Readers without them fall into the worst-comprehension
scanning pattern there is.

## 4. Nothing runs more than four lines without a break.

A break is a heading, a list, a table, or a diagram. Four lines of prose is the
longest unbroken run a skimming eye will tolerate before it stops landing.

## 5. Two dimensions means a table.

Anything with a row-and-column shape — field by type, state by behaviour,
before by after — is a table. Never prose. Prose forces the reader to rebuild
the table in their head.

## 6. One diagram per structural idea, and diagram the system.

Diagram what the thing is, not the argument for it. Boxes and arrows for
components and data flow; sequence for ordering; state machines for lifecycles.
A diagram of a decision is a brainstorming artifact.

If a section describes structure and has no diagram, the diagram is missing.

## 7. Sentences under 25 words. One clause each.

Watch the em dash: every one is a subordinate clause the reader has to hold in
working memory while the sentence finishes. A spec is reference material, not
an essay. Essay cadence is the single strongest signal that a document is
thinking out loud.

## 8. Every section survives being read alone.

Readers arrive by scroll position, by comment link, by search. No section may
depend on the reader having read the one above it.

## 9. Detail goes below, never in the middle.

Three audiences read the same spec: someone deciding wants the shape in 30
seconds, a reviewer wants the tradeoffs, an implementer wants the detail. Order
the document that way. Detail placed early costs you the first two readers.

Length is a weapon against review. A document long enough to deter reading is a
document nobody objects to, which is not the same as a document nobody has
objections to.

## Checkable summary

| Rule | Threshold |
|---|---|
| Options, questions, tradeoffs | zero |
| Answer stated by | word 100 |
| Words per heading | under 150 |
| Unbroken prose run | under 4 lines |
| Sentence length | under 25 words |
| Two-dimensional facts | in a table |
| Sections describing structure | have a diagram |
| Section read out of order | still makes sense |
