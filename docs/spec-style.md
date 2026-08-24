# How to write a spec people will actually read

A spec in Pairdown has one job: let someone who was not in the design
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

## Diagrams

A diagram is not a picture of the prose. It is a different way of storing the
same information, and it earns its place only when that difference does work.

### 10. A diagram must remove search, not decorate

Larkin and Simon's finding is the whole basis for this: a diagram beats a
paragraph because information is indexed by **location**, so the fact you need
and the cue to the next step sit adjacent to each other and the reader traverses
instead of searching. The advantage is computational, not aesthetic — the same
information, indexed so that inference is cheap.

The test: name a question a reader can answer by looking, that the prose made
them hold three things in their head to answer. If there isn't one, it is
decoration.

### 11. Decoration is not neutral — it costs

Adding illustrations that carry no information makes readers **like** a document
more and learn from it no better. Worse, a graphic that grabs attention without
paying it back competes for the same working memory the content needs.

So a diagram that survives only because it looks good is a net loss. If removing
it loses no information, remove it.

### 12. One idea per diagram

If you cannot name what it shows in a single clause without using "and", it is
two diagrams.

### 13. Label in place. Never use a legend

Text goes next to the thing it names. A legend makes the reader hold a mapping in
working memory and look back and forth for every element — the cost the diagram
was supposed to remove.

### 14. Encode by position or length, never area or colour

Position along a common scale is read 1.4 to 2.5 times more accurately than
length, and about twice as accurately as angle. Area is worst of the common
encodings.

So: no pie charts, no bubble sizes, no colour ramps for anything a reader must
compare. Colour distinguishes categories; it does not carry magnitude.

### 15. Write for an expert and cut the scaffolding

Explanations embedded in a diagram help a novice and are redundant load for
someone who already has the schema. This audience knows what a websocket is.
Label the parts; do not explain the parts.

### 16. Use HTML for anything text-heavy, SVG for geometry

Hand-positioned SVG text is guesswork: the author cannot measure what the browser
will render, so labels clip and boxes misalign. This has happened in this project
more than once. HTML lays text out and wraps it; SVG is for shapes, arrows and
spatial relationships. Both must read correctly in light and dark, which means
colours come from the palette tokens rather than from literals.

### Checkable summary

| Rule | Threshold |
|---|---|
| Answers a question the prose made you hold in your head | at least one |
| Carries information you would otherwise have to state | always |
| Ideas per diagram | one |
| Legends | zero |
| Magnitude encoded as area, angle or colour | never |
| Explaining what the audience already knows | never |
| Text positioned by hand in SVG | never |
| Readable in both light and dark | always |
