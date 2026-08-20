// The outline rail: a live table of contents in the left margin.
//
// The research reason this exists: readers scan documents by bouncing between
// headings, and comprehend almost as well as readers who read every word — but
// only if there is a ladder of headings to bounce between. A document dense
// enough that its own author cannot skim it (the failure this project started
// from) still gets that ladder here, built from the structure rather than the
// writer's discipline.
//
// outlineOf is the exact same pure scan the agent's `outline` tool uses
// (src/outline.ts) — imported, not re-implemented, so the tree a person sees
// here and the tree the agent sees never disagree.
import { outlineOf } from "../src/outline";

/**
 * Mount the rail into `el`.
 *
 * - `getText()` returns the current document text.
 * - `getComments()` returns the resolved document positions (plain numbers)
 *   of every comment that should count against a section — the caller
 *   (editor.js) is responsible for turning a comment's anchor into a
 *   position and for deciding which comments qualify (unresolved, and still
 *   anchored to real text); editor.js already owns the anchor -> position
 *   resolver, so that logic is reused rather than duplicated here.
 *
 * A comment counts against the section that visually holds it: from that
 * heading's offset up to (not including) the next heading's offset, or the
 * end of the document for the last heading. A position before the first
 * heading counts nowhere, matching outlineOf's own choice to drop preamble
 * content — there is no entry to hang that count on.
 *
 * Returns a `paint` function. The caller decides when to call it; see
 * editor.js, which schedules it from the same rAF-debounced spot comment-card
 * layout already runs from, so a burst of keystrokes or comment edits repaints
 * the rail once per frame rather than once per change, and never sits more
 * than a frame stale.
 */
export function mountRail(el, view, getText, getComments) {
  function paint() {
    const entries = outlineOf(getText());
    const positions = getComments();

    el.replaceChildren(...entries.map((e, i) => {
      const nextOffset = i + 1 < entries.length ? entries[i + 1].offset : Infinity;
      const count = positions.reduce(
        (n, p) => n + (p >= e.offset && p < nextOffset ? 1 : 0), 0,
      );

      const a = document.createElement("a");
      a.href = "#";
      a.className = e.level > 1 ? `d${Math.min(e.level, 3)}` : "";
      a.textContent = e.title;
      if (count) {
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = String(count);
        a.appendChild(mark);
      }
      a.onclick = (ev) => {
        ev.preventDefault();
        view.dispatch({ selection: { anchor: e.offset }, scrollIntoView: true });
        view.focus();
      };
      return a;
    }));
  }
  return paint;
}
