// The browser half: a collaborative markdown editor with live-preview styling,
// remote cursors, and comments anchored to positions that survive editing.
//
// The document stays plain markdown in a Y.Text. That matters: the agent's
// edit_spec finds and replaces a unique passage of markdown, which only works
// while the shared document is text rather than a node tree.
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { EditorView, keymap, drawSelection, highlightActiveLine, Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import DOMPurify from "dompurify";
import { EditorState, RangeSetBuilder, StateField, StateEffect } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { yCollab } from "y-codemirror.next";

// ---- identity ---------------------------------------------------------------

// Violet is reserved for Claude and deliberately absent here: a colour any
// human could also be given would not distinguish the agent from a colleague.
const PALETTE = ["#2f6f5e", "#a3651f", "#b0453f", "#2450b5", "#1f7a6f", "#964d8a", "#7a5c2e"];
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function askName(force) {
  let n = localStorage.getItem("spec-room.name");
  if (!n || force) {
    n = (prompt("Your name (shown on comments and your cursor)", n || "") || "").trim();
    if (n) localStorage.setItem("spec-room.name", n);
  }
  return n || "anonymous";
}
let ME = askName(false);

// ---- shared document --------------------------------------------------------

const doc = new Y.Doc();
const content = doc.getText("content");
const comments = doc.getArray("comments");
const awareness = new Awareness(doc);

awareness.setLocalStateField("user", {
  name: ME,
  color: colorFor(ME),
  colorLight: colorFor(ME) + "33",
});

// ---- transport --------------------------------------------------------------
// Binary frames carry a one-byte tag: 0 = document update, 1 = awareness.
// Text frames are presence JSON from the server.

const DOC_MSG = 0, AWARE_MSG = 1;
const wsScheme = location.protocol === "https:" ? "wss://" : "ws://";
const ws = new WebSocket(wsScheme + location.host + "/ws");
ws.binaryType = "arraybuffer";

function tagged(tag, payload) {
  const out = new Uint8Array(payload.length + 1);
  out[0] = tag;
  out.set(payload, 1);
  return out;
}

const el = (id) => document.getElementById(id);
function setStatus(connected) {
  el("wsdot").className = "dot " + (connected ? "on" : "off");
  el("wsstate").textContent = connected ? "connected" : "disconnected";
}

ws.onopen = () => {
  setStatus(true);
  ws.send(tagged(AWARE_MSG, encodeAwarenessUpdate(awareness, [doc.clientID])));
};
ws.onclose = () => setStatus(false);
ws.onerror = () => setStatus(false);

ws.onmessage = (ev) => {
  if (typeof ev.data === "string") {
    const m = JSON.parse(ev.data);
    if (m.type === "presence") {
      el("agentdot").className = "dot " + (m.agent ? "on" : "off");
      el("agentstate").textContent = m.agent ? "agent attached" : "no agent attached";
      el("agentstate").classList.toggle("muted", !m.agent);
    }
    if (m.type === "agent-busy") setAgentBusy(m.busy, m.comment_id);
    return;
  }
  const buf = new Uint8Array(ev.data);
  const tag = buf[0], payload = buf.subarray(1);
  if (tag === DOC_MSG) Y.applyUpdate(doc, payload, "remote");
  else if (tag === AWARE_MSG) applyAwarenessUpdate(awareness, payload, "remote");
};

doc.on("update", (update, origin) => {
  if (origin === "remote") return;
  if (ws.readyState === 1) ws.send(tagged(DOC_MSG, update));
});

awareness.on("update", ({ added, updated, removed }, origin) => {
  if (origin === "remote") return;
  const changed = added.concat(updated, removed);
  if (ws.readyState === 1) ws.send(tagged(AWARE_MSG, encodeAwarenessUpdate(awareness, changed)));
});

window.addEventListener("beforeunload", () => awareness.destroy());

// ---- live-preview styling ---------------------------------------------------
// Headings, emphasis and code are styled as they would render, while the text
// underneath stays markdown. The syntax markers themselves are dimmed here and
// hidden entirely by the plugin below unless the cursor is on that line.

const liveStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.9em", fontWeight: "700", lineHeight: "1.25", color: "var(--ink)" },
  { tag: t.heading2, fontSize: "1.45em", fontWeight: "650", lineHeight: "1.3", color: "var(--ink)" },
  { tag: t.heading3, fontSize: "1.18em", fontWeight: "650", color: "var(--ink)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "650", color: "var(--ink)" },
  { tag: t.strong, fontWeight: "700", color: "var(--ink)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.92em",
    background: "var(--accent-bg)", color: "var(--accent-ink)", padding: "0.08em 0.28em", borderRadius: "3px" },
  { tag: [t.link, t.url], color: "var(--accent-ink)", textDecoration: "underline" },
  { tag: t.quote, color: "var(--soft)", fontStyle: "italic" },
  { tag: t.list, color: "var(--ink)" },
  { tag: t.processingInstruction, color: "var(--faint)" },
]);

// Node names produced by the markdown parser for the syntax characters.
const MARKS = new Set([
  "HeaderMark", "EmphasisMark", "StrongMark", "CodeMark",
  "QuoteMark", "LinkMark", "StrikethroughMark",
]);

function buildMarkers(state) {
  const builder = new RangeSetBuilder();
  // Leave every marker visible on the line the cursor is on, so editing the
  // syntax is still possible — the Obsidian behaviour people expect.
  const activeLines = new Set();
  for (const r of state.selection.ranges) {
    activeLines.add(state.doc.lineAt(r.head).number);
    if (r.anchor !== r.head) activeLines.add(state.doc.lineAt(r.anchor).number);
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!MARKS.has(node.name)) return;
      const line = state.doc.lineAt(node.from);
      if (activeLines.has(line.number)) return;
      // Never touch a fenced block's own ``` markers — those lines are already
      // covered by a block replacement.
      if (node.name === "CodeMark" && line.text.trimStart().startsWith("```")) return;
      if (node.to > node.from) builder.add(node.from, node.to, Decoration.replace({}));
    },
  });
  return builder.finish();
}

// A StateField, not a ViewPlugin. Replace decorations coming from two different
// sources compose in an order CodeMirror does not guarantee, and mixing a field
// (the blocks) with a plugin (these markers) made click position disagree with
// coordinate mapping — clicks landed a line low, once per block above them.
const hideMarkers = StateField.define({
  create: (state) => buildMarkers(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildMarkers(tr.state);
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- visual blocks ----------------------------------------------------------
// A fenced ```svg or ```html block, and any markdown image, renders in place
// when your cursor is elsewhere, and reverts to source the moment you click
// into it. Diagrams stay text in the document, which is what lets the agent
// write them and lets edit_spec change them.
//
// Everything is sanitised. This document is writable by anyone holding the
// link, so unsanitised markup would let any collaborator run script in every
// other viewer's browser.

const CLEAN = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "link", "meta", "base"],
  FORBID_ATTR: ["srcdoc", "formaction", "ping"],
};

// CodeMirror needs a height for a replaced block *before* it renders one, and
// gets it wrong for a diagram — the height map then drifts from the real layout
// and clicks land low, accumulating one block at a time. Cache what each block
// actually measured and hand it back as the estimate next time.
const BLOCK_HEIGHTS = new Map();
const DEFAULT_BLOCK_HEIGHT = { mermaid: 240, svg: 240, html: 180, image: 200 };

function rememberHeight(key, px) {
  if (px > 0) BLOCK_HEIGHTS.set(key, px);
}

// Mermaid is loaded on demand — it is by far the largest dependency here, and
// most documents never contain a diagram.
let mermaidReady = null;
function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then(({ default: mermaid }) => {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
        // Mermaid puts node labels in <foreignObject> by default, which the
        // sanitiser strips — leaving diagrams with boxes and no words. Plain
        // <text> labels survive sanitising and look the same here.
        htmlLabels: false,
        flowchart: { htmlLabels: false, curve: "basis" },
        class: { htmlLabels: false },
        state: { htmlLabels: false },
        themeVariables: {
          background: "transparent",
          primaryColor: dark ? "#1b2334" : "#e7ecf7",
          primaryBorderColor: dark ? "#9db8ff" : "#24479e",
          primaryTextColor: dark ? "#e7ebe6" : "#171c19",
          lineColor: dark ? "#99a39d" : "#5d6662",
          secondaryColor: dark ? "#191d1a" : "#fbfcfa",
          tertiaryColor: dark ? "#191d1a" : "#fbfcfa",
          fontSize: "13px",
        },
      });
      return mermaid;
    });
  }
  return mermaidReady;
}

let mermaidSeq = 0;

/**
 * Keep CodeMirror's height map honest.
 *
 * A widget that changes size after it is inserted — a diagram that renders
 * asynchronously, an image that loads, an SVG that reflows when fonts arrive —
 * leaves CodeMirror believing the old height. Every click below it then maps to
 * the wrong document position, which is what made the text near the bottom of a
 * document with diagrams in it impossible to click accurately.
 */
function remeasureOnResize(el, view, key) {
  if (typeof ResizeObserver === "undefined") return;
  let last = -1;
  const ro = new ResizeObserver(() => {
    const h = el.getBoundingClientRect().height;
    if (Math.abs(h - last) < 1) return;
    last = h;
    rememberHeight(key, h);
    view?.requestMeasure();
  });
  ro.observe(el);
}

/**
 * Wrap a rendered block so its spacing is measurable.
 *
 * CodeMirror measures a block widget's element height, and that measurement
 * EXCLUDES margins. A card with vertical margins is therefore taller than
 * CodeMirror believes, and every position below it drifts — by roughly a line
 * and a half per block, which is why clicking below three diagrams landed four
 * lines out. The spacing lives on this outer element as padding instead.
 */
function blockShell(inner) {
  const outer = document.createElement("div");
  outer.className = "embed-shell";
  outer.appendChild(inner);
  return outer;
}

class MermaidWidget extends WidgetType {
  constructor(source) { super(); this.source = source; this.key = "mermaid:" + source; }
  eq(other) { return other.source === this.source; }
  get estimatedHeight() { return BLOCK_HEIGHTS.get(this.key) ?? DEFAULT_BLOCK_HEIGHT.mermaid; }
  toDOM(view) {
    const wrap = document.createElement("div");
    wrap.className = "embed embed-mermaid";
    wrap.textContent = "rendering diagram…";
    const shell = blockShell(wrap);
    remeasureOnResize(shell, view, this.key);
    loadMermaid()
      .then((mermaid) => mermaid.render("mmd-" + mermaidSeq++, this.source))
      .then(({ svg }) => {
        wrap.textContent = "";
        // mermaid output is generated from the source, but the source came from
        // a shared document, so it goes through the sanitiser like everything else
        wrap.innerHTML = DOMPurify.sanitize(svg, CLEAN);
        view?.requestMeasure();
      })
      .catch((e) => {
        wrap.className = "embed embed-error";
        wrap.textContent = "mermaid could not render this: " + (e?.message ?? e);
        view?.requestMeasure();
      });
    return shell;
  }
}

class MarkupWidget extends WidgetType {
  constructor(source, kind) { super(); this.source = source; this.kind = kind; this.key = kind + ":" + source; }
  eq(other) { return other.source === this.source && other.kind === this.kind; }
  ignoreEvent() { return false; }
  get estimatedHeight() { return BLOCK_HEIGHTS.get(this.key) ?? DEFAULT_BLOCK_HEIGHT[this.kind] ?? 200; }
  toDOM(view) {
    const wrap = document.createElement("div");
    wrap.className = "embed embed-" + this.kind;
    const shell = blockShell(wrap);
    remeasureOnResize(shell, view, this.key);
    try {
      wrap.innerHTML = DOMPurify.sanitize(this.source, CLEAN);
      if (!wrap.innerHTML.trim()) throw new Error("nothing left after sanitising");
    } catch (e) {
      wrap.className = "embed embed-error";
      wrap.textContent = `${this.kind} could not be rendered: ${e.message}`;
    }
    return shell;
  }
}

class ImageWidget extends WidgetType {
  constructor(url, alt) { super(); this.url = url; this.alt = alt; this.key = "img:" + url; }
  eq(other) { return other.url === this.url && other.alt === this.alt; }
  get estimatedHeight() { return BLOCK_HEIGHTS.get(this.key) ?? DEFAULT_BLOCK_HEIGHT.image; }
  toDOM(view) {
    const wrap = document.createElement("div");
    wrap.className = "embed embed-image";
    const shell = blockShell(wrap);
    remeasureOnResize(shell, view, this.key);
    // http(s) and data: only — no javascript: or file: URLs from a shared doc
    if (!/^(https?:|data:image\/)/i.test(this.url)) {
      wrap.className = "embed embed-error";
      wrap.textContent = "image blocked: only http(s) and data:image URLs render";
      return shell;
    }
    const img = document.createElement("img");
    img.src = this.url;
    img.alt = this.alt || "";
    img.loading = "lazy";
    img.onload = () => view?.requestMeasure();
    img.onerror = () => {
      wrap.className = "embed embed-error";
      wrap.textContent = "image failed to load: " + this.url;
      view?.requestMeasure();
    };
    wrap.appendChild(img);
    return shell;
  }
}

const RENDERABLE = { svg: "svg", html: "html", xml: "svg" };

// Block-level decorations must come from a StateField — CodeMirror refuses them
// from a ViewPlugin, because block geometry has to be known before layout.
function buildBlocks(state) {
  const widgets = [];
  const touched = (from, to) =>
    state.selection.ranges.some((r) => r.to >= from - 1 && r.from <= to + 1);

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode") {
        const text = state.doc.sliceString(node.from, node.to);
        const m = text.match(/^```+[ \t]*([A-Za-z0-9_-]*)[ \t]*\n([\s\S]*?)\n?```+[ \t]*$/);
        if (!m) return;
        const lang = (m[1] || "").toLowerCase();
        if (touched(node.from, node.to)) return;
        if (lang === "mermaid") {
          widgets.push(
            Decoration.replace({ widget: new MermaidWidget(m[2]), block: true })
              .range(node.from, node.to),
          );
          return;
        }
        const kind = RENDERABLE[lang];
        if (!kind) return;
        widgets.push(
          Decoration.replace({ widget: new MarkupWidget(m[2], kind), block: true })
            .range(node.from, node.to),
        );
      } else if (node.name === "Image") {
        if (touched(node.from, node.to)) return;
        const raw = state.doc.sliceString(node.from, node.to);
        const m = raw.match(/^!\[([^\]]*)\]\(([^)\s]+)/);
        if (!m) return;
        widgets.push(
          Decoration.replace({ widget: new ImageWidget(m[2], m[1]), block: true })
            .range(node.from, node.to),
        );
      }
    },
  });
  return Decoration.set(widgets, true);
}

const renderBlocks = StateField.define({
  create: (state) => buildBlocks(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildBlocks(tr.state);
    return deco.map(tr.changes);
  },
  // NOTE: deliberately not registering these as atomicRanges. Doing so tells
  // CodeMirror to push a caret to the far side of each block, which relocates
  // clicks near a diagram instead of honouring them.
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "18px", backgroundColor: "transparent", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  // Document padding belongs on .cm-content, never on .cm-scroller. CodeMirror
  // measures positions relative to the content element, so padding on the
  // scroller shifts what you see without shifting what it computes — every
  // click then lands roughly that many pixels low.
  ".cm-scroller": {
    fontFamily: "var(--serif)", lineHeight: "1.65", overflow: "auto",
  },
  ".cm-content": {
    maxWidth: "42rem", margin: "0 auto",
    padding: "2.6rem 1.5rem", caretColor: "var(--ink)",
  },
  ".cm-line": { padding: "0" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-bg) !important" },
  ".embed-shell": { padding: "1.1rem 0" },
  ".embed": {
    margin: "0", padding: "1rem", borderRadius: "4px",
    background: "var(--card)", border: "1px solid var(--rule)",
    display: "flex", justifyContent: "center", cursor: "pointer",
  },
  ".embed svg, .embed img": { maxWidth: "100%", height: "auto", display: "block" },
  ".embed-html": { display: "block", fontFamily: "var(--sans)", fontSize: "0.9rem" },
  ".embed-error": {
    display: "block", fontFamily: "var(--mono)", fontSize: "0.7rem",
    color: "#b0453f", background: "transparent", borderStyle: "dashed",
  },
  ".cm-ySelectionInfo": {
    fontFamily: "var(--mono)", fontSize: "0.62rem", fontWeight: "500",
    padding: "1px 4px", opacity: "1", top: "-1.35em", borderRadius: "2px",
  },
});

// ---- inline comment highlights ----------------------------------------------
// Comments live in the Yjs document rather than editor state, so their
// decorations are pushed in with an effect when the comment set changes and
// mapped through document changes in between. Declared here because the editor
// below needs it at construction time.

const setHighlights = StateEffect.define();

const highlightField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setHighlights)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- editor -----------------------------------------------------------------

const undoManager = new Y.UndoManager(content);

const view = new EditorView({
  parent: el("editor"),
  state: EditorState.create({
    doc: content.toString(),
    extensions: [
      history(),
      drawSelection(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(liveStyle),
      hideMarkers,
      renderBlocks,
      highlightField,
      theme,
      yCollab(content, awareness, { undoManager }),
    ],
  }),
});

// Debug handle: lets a test driver (and a console) reach the editor state.
// Read-only in practice — nothing in the app depends on it.
window.__specroom = { view, doc, content, comments, awareness };

// ---- who is here ------------------------------------------------------------

function renderPeople() {
  const host = el("people");
  host.innerHTML = "";
  const seen = new Map();
  awareness.getStates().forEach((state, clientId) => {
    const u = state.user;
    if (!u || !u.name) return;
    if (!seen.has(u.name)) seen.set(u.name, { ...u, me: clientId === doc.clientID });
  });
  for (const u of seen.values()) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.borderColor = u.color;
    chip.style.color = u.color;
    chip.textContent = u.name + (u.me ? " (you)" : "");
    host.appendChild(chip);
  }
}
awareness.on("change", renderPeople);
renderPeople();

el("rename").onclick = () => {
  ME = askName(true);
  awareness.setLocalStateField("user", { name: ME, color: colorFor(ME), colorLight: colorFor(ME) + "33" });
  renderPeople();
};

// ---- agent activity ---------------------------------------------------------

function setAgentBusy(busy, commentId) {
  busyFor = busy ? (commentId ?? true) : null;
  el("thinking").hidden = !busy;
  render();
}

// ---- comments ---------------------------------------------------------------
// Cards live in the right margin, aligned to the text they belong to, pushed
// down when they would overlap, and scrolling away with the document.
//
// Decisions this implements, from the spec:
//   - resolved comments grey out and stay, lower profile but readable
//   - a comment whose text is gone persists and says so, styled like resolved
//   - Claude's replies get a reserved colour and an icon
//   - no notifications
//
// Three anchor states, not two. A comment can lose its text by deletion, in
// which case the anchor stops resolving — but it can also lose its text by
// substitution, where the anchor still resolves perfectly onto whatever now
// occupies those positions. That second case is the dangerous one: it looks
// correct while pointing at words nobody commented on. Both are treated as
// detached, and neither highlights the document.

const AGENT = "claude";
const CARD_GAP = 10;
const COLLAPSE_CHARS = 260;

const b64 = {
  enc: (u) => btoa(String.fromCharCode.apply(null, Array.from(u))),
  dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};
const anchorFor = (i) =>
  b64.enc(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(content, i)));
function resolveAnchor(a) {
  try {
    const abs = Y.createAbsolutePositionFromRelativePosition(
      Y.decodeRelativePosition(b64.dec(a)), doc);
    return abs ? abs.index : null;
  } catch (e) { return null; }
}

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Has the anchored text changed out from under the comment?
 *
 * Deliberately strict: normalised equality, or one string containing the other
 * so a typo fix or a trimmed edge still counts as the same passage. Anything
 * else is called drift. Over-flagging is the safer failure — a comment marked
 * detached when the text merely moved is a small annoyance, while a comment
 * silently pointing at unrelated words is misinformation.
 */
function textDrifted(quote, current) {
  const q = squash(quote), c = squash(current);
  if (!q) return false;            // nothing to compare against
  if (!c) return true;             // range collapsed to nothing
  if (q === c) return false;
  return !(c.includes(q) || q.includes(c));
}

function commentViews() {
  const out = [];
  const docText = view.state.doc;
  for (const m of comments) {
    const from = resolveAnchor(m.get("anchorFrom"));
    const to = resolveAnchor(m.get("anchorTo"));
    const replies = m.get("replies");
    const quote = m.get("quote") || "";

    let state = m.get("resolved") ? "resolved" : "open";
    let current = "";
    if (from === null || to === null || to <= from) {
      state = "deleted";
    } else {
      current = docText.sliceString(from, Math.min(to, from + 2000));
      if (textDrifted(quote, current)) state = "changed";
    }
    const detached = state === "deleted" || state === "changed";

    out.push({
      map: m,
      id: m.get("id"),
      author: m.get("author") || "anonymous",
      body: m.get("body") || "",
      quote,
      current,
      state,
      detached,
      resolved: state === "resolved",
      forAgent: Boolean(m.get("forAgent")),
      createdAt: m.get("createdAt") || "",
      replies: replies && replies.toArray ? replies.toArray() : [],
      from: detached ? null : from,
      to: detached ? null : to,
    });
  }
  out.sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity));
  return out;
}

function deleteComment(id) {
  for (let i = 0; i < comments.length; i++) {
    if (comments.get(i).get("id") === id) { comments.delete(i, 1); return true; }
  }
  return false;
}

// ---- card rendering ---------------------------------------------------------

let focusedId = null;
let busyFor = null;

const AGENT_ICON =
  '<svg class="cmt-agent-icon" viewBox="0 0 12 12" aria-hidden="true">' +
  '<path d="M6 0.6 L7.4 4.6 L11.4 6 L7.4 7.4 L6 11.4 L4.6 7.4 L0.6 6 L4.6 4.6 Z"/></svg>';

const isAgent = (name) => String(name).toLowerCase() === AGENT;

function avatar(name) {
  const s = document.createElement("span");
  if (isAgent(name)) {
    s.className = "cmt-who cmt-who-agent";
    s.innerHTML = AGENT_ICON;
  } else {
    s.className = "cmt-who";
    s.style.background = colorFor(name);
  }
  return s;
}

function metaRow(name, at) {
  const meta = document.createElement("div");
  meta.className = "cmt-meta";
  meta.appendChild(avatar(name));
  const who = document.createElement("span");
  who.className = isAgent(name) ? "cmt-name cmt-name-agent" : "cmt-name";
  who.textContent = isAgent(name) ? "Claude" : name;
  meta.appendChild(who);
  if (at) {
    const t = document.createElement("span");
    t.className = "cmt-time";
    t.textContent = String(at).slice(11, 16);
    meta.appendChild(t);
  }
  return meta;
}

function replyBlock(r) {
  const rd = document.createElement("div");
  rd.className = "cmt-reply" + (isAgent(r.author) ? " cmt-reply-agent" : "");
  rd.appendChild(metaRow(r.author, r.at));
  const t = document.createElement("div");
  t.className = "cmt-body";
  t.textContent = r.body || "";
  rd.appendChild(t);
  return rd;
}

/** Two-step delete, so a stray click never destroys a thread. */
function deleteButton(id, onDone) {
  const btn = document.createElement("button");
  btn.className = "cmt-mini cmt-danger";
  btn.textContent = "delete";
  let armed = false;
  btn.onclick = (e) => {
    e.stopPropagation();
    if (!armed) {
      armed = true;
      btn.textContent = "delete — sure?";
      btn.classList.add("cmt-armed");
      setTimeout(() => {
        if (!armed) return;
        armed = false;
        btn.textContent = "delete";
        btn.classList.remove("cmt-armed");
      }, 3000);
      return;
    }
    deleteComment(id);
    if (onDone) onDone();
  };
  return btn;
}

function stateNote(c) {
  if (c.state === "deleted") return "the text this referred to was deleted";
  if (c.state === "changed") return "the text this referred to has changed";
  return null;
}

function buildCard(c, opts = {}) {
  const card = document.createElement("div");
  card.className = [
    "cmt",
    c.forAgent ? "cmt-agent" : "",
    c.resolved || c.detached ? "cmt-dim" : "",
    c.detached ? "cmt-detached" : "",
    c.id === focusedId ? "cmt-focus" : "",
  ].join(" ").trim();
  card.dataset.id = c.id;

  card.appendChild(metaRow(c.author, c.createdAt));

  const note = stateNote(c);
  if (note) {
    const n = document.createElement("div");
    n.className = "cmt-gone";
    n.textContent = note;
    card.appendChild(n);
    if (c.quote) {
      const was = document.createElement("div");
      was.className = "cmt-was";
      was.textContent = "was: " + c.quote.slice(0, 120);
      card.appendChild(was);
    }
  }

  const body = document.createElement("div");
  body.className = "cmt-body";
  body.textContent = c.body;
  card.appendChild(body);

  if (busyFor === c.id) {
    const w = document.createElement("div");
    w.className = "cmt-working";
    w.innerHTML = "<i></i> Claude is working…";
    card.appendChild(w);
  }

  const total = c.body.length + c.replies.reduce((n, r) => n + (r.body?.length ?? 0), 0);
  const long = total > COLLAPSE_CHARS || c.replies.length > 1;

  if (c.replies.length && !long) {
    for (const r of c.replies) card.appendChild(replyBlock(r));
  } else if (c.replies.length || long) {
    if (long && !c.replies.length) body.classList.add("cmt-body-clamp");
    const more = document.createElement("button");
    more.className = "cmt-expand";
    more.textContent = c.replies.length
      ? (c.replies.length === 1 ? "1 reply — read thread" : c.replies.length + " replies — read thread")
      : "read in full";
    more.onclick = (e) => { e.stopPropagation(); openPanel(c.id); };
    card.appendChild(more);
  }

  const actions = document.createElement("div");
  actions.className = "cmt-actions";
  const resolveBtn = document.createElement("button");
  resolveBtn.className = "cmt-mini";
  resolveBtn.textContent = c.resolved ? "reopen" : "resolve";
  resolveBtn.onclick = (e) => { e.stopPropagation(); c.map.set("resolved", !c.resolved); };
  if (!c.detached) actions.appendChild(resolveBtn);
  const replyBtn = document.createElement("button");
  replyBtn.className = "cmt-mini";
  replyBtn.textContent = "reply";
  replyBtn.onclick = (e) => { e.stopPropagation(); openPanel(c.id); };
  actions.appendChild(replyBtn);
  actions.appendChild(deleteButton(c.id, opts.onDelete || scheduleLayout));
  card.appendChild(actions);

  if (!c.detached) card.onclick = () => focusComment(c.id, true);
  return card;
}

// ---- layout -----------------------------------------------------------------

function highlightsFor(views) {
  const ranges = [];
  for (const c of views) {
    // detached comments never highlight: the positions may still resolve, but
    // they no longer point at the text the comment was about
    if (c.detached || c.from === null || c.to === null) continue;
    const cls = [
      "cmt-hl",
      c.resolved ? "cmt-hl-resolved" : c.forAgent ? "cmt-hl-agent" : "cmt-hl-open",
      c.id === focusedId ? "cmt-hl-focus" : "",
    ].join(" ").trim();
    ranges.push(Decoration.mark({ class: cls }).range(c.from, c.to));
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(ranges, true);
}

function layoutCards() {
  const host = el("comments");
  const views = commentViews();
  const anchoredViews = views.filter((c) => !c.detached);
  const detachedViews = views.filter((c) => c.detached);

  host.innerHTML = "";

  if (!views.length) {
    const empty = document.createElement("p");
    empty.className = "cmt-empty";
    empty.innerHTML =
      "Select any text to comment on it.<br>Mention <b>@claude</b> to ask the attached session.";
    host.appendChild(empty);
  }

  const contentRect = view.contentDOM.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();

  const placed = [];
  for (const c of anchoredViews) {
    const card = buildCard(c);
    card.style.position = "absolute";
    card.style.visibility = "hidden";
    host.appendChild(card);
    const block = view.lineBlockAt(c.from);
    placed.push({ card, desired: contentRect.top + block.top - hostRect.top });
  }
  placed.sort((a, b) => a.desired - b.desired);

  // No floor on the first position. Cards above the viewport get negative tops
  // and are clipped away, which is what makes them scroll off the page instead
  // of stacking against the top and crowding out everything below.
  let cursor = -1e6;
  for (const p of placed) {
    const top = Math.max(p.desired, cursor);
    p.card.style.top = Math.round(top) + "px";
    p.card.style.visibility = "visible";
    cursor = top + p.card.offsetHeight + CARD_GAP;
  }

  // Detached comments have no position to sit at, so they collapse into a
  // pinned footer rather than eating margin space at the end of the document.
  const footer = el("detached");
  if (detachedViews.length) {
    footer.hidden = false;
    footer.textContent =
      detachedViews.length === 1
        ? "1 detached comment"
        : detachedViews.length + " detached comments";
    footer.onclick = () => openDetachedPanel();
  } else {
    footer.hidden = true;
  }

  view.dispatch({ effects: setHighlights.of(highlightsFor(views)) });
}

let layoutQueued = false;
function scheduleLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => { layoutQueued = false; layoutCards(); });
}
function render() { scheduleLayout(); }

function focusComment(id, scroll) {
  focusedId = id;
  const c = commentViews().find((x) => x.id === id);
  if (c && scroll && c.from !== null) {
    view.dispatch({ selection: { anchor: c.from, head: c.to }, scrollIntoView: true });
    view.focus();
  }
  scheduleLayout();
}

// ---- panels -----------------------------------------------------------------

function closePanel() {
  const p = el("panel");
  p.hidden = true;
  p.innerHTML = "";
}

function panelShell(titleText) {
  const panel = el("panel");
  panel.hidden = false;
  panel.innerHTML = "";
  const head = document.createElement("div");
  head.className = "panel-head";
  const title = document.createElement("span");
  title.textContent = titleText;
  head.appendChild(title);
  const x = document.createElement("button");
  x.className = "cmt-mini";
  x.textContent = "close";
  x.onclick = closePanel;
  head.appendChild(x);
  panel.appendChild(head);
  return panel;
}

function openPanel(id) {
  const c = commentViews().find((x) => x.id === id);
  if (!c) return;
  focusedId = id;
  const note = stateNote(c);
  const panel = panelShell(note ? "Comment — " + note : "Comment");

  const q = document.createElement("div");
  if (c.detached) {
    q.className = "panel-quote panel-quote-gone";
    q.textContent = c.quote ? "was: " + c.quote.slice(0, 400) : note || "";
  } else {
    q.className = "panel-quote";
    q.textContent = view.state.doc.sliceString(c.from, Math.min(c.to, c.from + 400));
  }
  panel.appendChild(q);

  const thread = document.createElement("div");
  thread.className = "panel-thread";
  const first = document.createElement("div");
  first.className = "cmt-reply";
  first.appendChild(metaRow(c.author, c.createdAt));
  const fb = document.createElement("div");
  fb.className = "cmt-body";
  fb.textContent = c.body;
  first.appendChild(fb);
  thread.appendChild(first);
  for (const r of c.replies) thread.appendChild(replyBlock(r));
  panel.appendChild(thread);

  const form = document.createElement("div");
  form.className = "panel-reply";
  const ta = document.createElement("textarea");
  ta.placeholder = "Reply. Mention @claude to ask the attached session.";
  form.appendChild(ta);
  const send = document.createElement("button");
  send.textContent = "Reply";
  send.onclick = () => {
    const text = ta.value.trim();
    if (!text) return;
    const replies = c.map.get("replies");
    doc.transact(() => {
      replies.push([{ author: ME, body: text, at: new Date().toISOString() }]);
      if (/(^|\s)@claude\b/i.test(text)) {
        c.map.set("forAgent", true);
        c.map.set("resolved", false);
      }
    }, "local");
    ta.value = "";
    openPanel(id);
  };
  form.appendChild(send);
  const del = deleteButton(id, closePanel);
  del.classList.add("panel-delete");
  form.appendChild(del);
  panel.appendChild(form);
}

function openDetachedPanel() {
  const detached = commentViews().filter((c) => c.detached);
  const panel = panelShell(
    "Detached — the text these referred to changed or was deleted",
  );
  const list = document.createElement("div");
  list.className = "panel-thread";
  if (!detached.length) {
    const p = document.createElement("p");
    p.className = "cmt-empty";
    p.textContent = "Nothing detached.";
    list.appendChild(p);
  }
  for (const c of detached) {
    const card = buildCard(c, { onDelete: () => openDetachedPanel() });
    card.style.position = "static";
    card.style.marginBottom = ".5rem";
    list.appendChild(card);
  }
  panel.appendChild(list);
}

// ---- composer ---------------------------------------------------------------

const composer = el("composer");
let pending = null;

function hideComposer() {
  composer.style.display = "none";
  pending = null;
}

view.dom.addEventListener("mouseup", () => {
  const sel = view.state.selection.main;
  if (sel.empty) { hideComposer(); return; }
  pending = { from: sel.from, to: sel.to };
  const coords = view.coordsAtPos(sel.head) || view.coordsAtPos(sel.from);
  composer.style.display = "block";
  const top = Math.min((coords ? coords.bottom : 200) + 8, window.innerHeight - 190);
  composer.style.top = Math.max(60, top) + "px";
  composer.style.left =
    Math.max(16, Math.min(coords ? coords.left : 100, window.innerWidth - 660)) + "px";
  el("ctext").focus();
});

el("ccancel").onclick = hideComposer;
el("cadd").onclick = () => {
  const body = el("ctext").value.trim();
  if (!body || !pending) return;
  const m = new Y.Map();
  doc.transact(() => {
    m.set("id", Math.random().toString(36).slice(2, 10));
    m.set("author", ME);
    m.set("body", body);
    m.set("quote", view.state.doc.sliceString(pending.from, pending.to));
    m.set("anchorFrom", anchorFor(pending.from));
    m.set("anchorTo", anchorFor(pending.to));
    m.set("resolved", false);
    m.set("forAgent", /(^|\s)@claude\b/i.test(body));
    m.set("createdAt", new Date().toISOString());
    m.set("replies", new Y.Array());
    comments.push([m]);
  }, "local");
  el("ctext").value = "";
  hideComposer();
};

// ---- keep the margin in step with the document ------------------------------

comments.observeDeep(scheduleLayout);
view.scrollDOM.addEventListener("scroll", scheduleLayout, { passive: true });
window.addEventListener("resize", scheduleLayout);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });

view.dom.addEventListener("mousedown", (e) => {
  const hl = e.target instanceof Element ? e.target.closest(".cmt-hl") : null;
  if (!hl) return;
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos == null) return;
  const hit = commentViews().find((c) => c.from !== null && pos >= c.from && pos <= c.to);
  if (hit) focusComment(hit.id, false);
});

view.dom.addEventListener("focusin", scheduleLayout);
scheduleLayout();
