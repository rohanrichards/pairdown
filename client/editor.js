// The browser half: a collaborative markdown editor with live-preview styling,
// remote cursors, and comments anchored to positions that survive editing.
//
// The document stays plain markdown in a Y.Text. That matters: the agent's
// edit_spec finds and replaces a unique passage of markdown, which only works
// while the shared document is text rather than a node tree.
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { EditorView, layer, RectangleMarker, keymap, drawSelection, highlightActiveLine, Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import DOMPurify from "dompurify";
import { EditorState, RangeSetBuilder, StateField, StateEffect } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Table, Strikethrough, TaskList } from "@lezer/markdown";
import { syntaxHighlighting, HighlightStyle, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { yCollab } from "y-codemirror.next";
import { blockRanges, blockAt } from "./blocks.js";
import { mountRail } from "./outline-rail.js";
import { anchorState } from "../src/anchor";

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
// Room-level state that is not the document: currently just the review request
// that pulls the agent in. Kept in the CRDT so every client sees the same thing.
const meta = doc.getMap("meta");
const awareness = new Awareness(doc);

awareness.setLocalStateField("user", {
  name: ME,
  color: colorFor(ME),
  colorLight: colorFor(ME) + "33",
});

// ---- transport --------------------------------------------------------------
// Binary frames carry a one-byte tag: 0 = document update, 1 = awareness.
// The page is served at /r/<id>, so the room id comes from the URL path.

const DOC_MSG = 0, AWARE_MSG = 1;
const ROOM_ID = (location.pathname.match(/^\/r\/([a-z0-9]{8})/) || [])[1] || "";
const proto = location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${proto}//${location.host}/ws?room=${ROOM_ID}`;

function tagged(tag, payload) {
  const out = new Uint8Array(payload.length + 1);
  out[0] = tag;
  out.set(payload, 1);
  return out;
}

const el = (id) => document.getElementById(id);
const DOT = { connected: "on", connecting: "wait", reconnecting: "wait" };
function setStatus(state) {
  el("wsdot").className = "dot " + DOT[state];
  el("wsstate").textContent = state;
}

// The socket is replaced on every reconnect, so nothing may capture it: send
// through the current one or not at all.
let ws = null;
let attempt = 0;
const BACKOFF_MS = [400, 800, 1600, 3200, 8000];
const live = () => ws !== null && ws.readyState === 1;

// Without this, a dropped socket left the editor fully usable — live preview,
// comment cards, the outline rail all still updating — while every keystroke
// went nowhere and nothing was saved. A person could write for minutes into a
// document that was no longer shared, with only a small dot to say so.
function connect() {
  setStatus(attempt === 0 ? "connecting" : "reconnecting");
  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    attempt = 0;
    setStatus("connected");
    // The whole local state, not just the updates since the last one. Anything
    // typed while the socket was down never reached the server, and a Yjs
    // update is commutative and idempotent — so merging a full state carries
    // those edits across without overwriting whatever else changed server-side
    // meanwhile. On a first connect it is a no-op the server already knows.
    ws.send(tagged(DOC_MSG, Y.encodeStateAsUpdate(doc)));
    ws.send(tagged(AWARE_MSG, encodeAwarenessUpdate(awareness, [doc.clientID])));
  };

  ws.onmessage = (ev) => {
    const buf = new Uint8Array(ev.data);
    const tag = buf[0], payload = buf.subarray(1);
    if (tag === DOC_MSG) Y.applyUpdate(doc, payload, "remote");
    else if (tag === AWARE_MSG) applyAwarenessUpdate(awareness, payload, "remote");
  };

  // onerror is always followed by onclose, so the retry lives in one place.
  ws.onerror = () => setStatus("reconnecting");
  ws.onclose = () => {
    setStatus("reconnecting");
    // Backoff, but no giving up: a room-server restart is the ordinary case
    // here, and the point of retrying is that the page comes back by itself
    // when it returns. The interval tops out so an unreachable server is a
    // heartbeat rather than a hammer.
    const wait = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)];
    setTimeout(connect, wait);
  };
}
connect();

doc.on("update", (update, origin) => {
  if (origin === "remote") return;
  if (live()) ws.send(tagged(DOC_MSG, update));
});

awareness.on("update", ({ added, updated, removed }, origin) => {
  if (origin === "remote") return;
  const changed = added.concat(updated, removed);
  if (live()) ws.send(tagged(AWARE_MSG, encodeAwarenessUpdate(awareness, changed)));
});

window.addEventListener("beforeunload", () => awareness.destroy());

// ---- room identity -----------------------------------------------------------
// The name lives in room meta so every client agrees on it.

const nameEl = el("roomname");
const paintName = () => { nameEl.textContent = meta.get("name") || "untitled"; };
meta.observe(paintName);
paintName();

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

// Every markup block — html, svg, xml — is rendered into a shadow root, so it
// may carry its own <style> element. That is the difference between a flat
// picture and something that responds to a pointer: :hover, :focus and
// transitions cannot be expressed in a style attribute at all. Shadow DOM scopes
// those rules to the one block, so a diagram cannot restyle or hide the
// application around it — which is the reason a <style> tag is not simply
// allowed inline.
//
// svg and xml used to skip this and go straight to innerHTML. DOMPurify allows
// <style> through (it is in its own html and svg allowlists), and a <style>
// inside inline SVG sits in the main document tree, where its rules are
// page-global. A ```svg block could therefore restyle or hide the whole
// application. FORBID_TAGS is not the answer: mermaid's generated SVG carries
// its own <style> through this same CLEAN, and forbidding it breaks diagram
// theming. Containment is.
//
// Custom properties inherit through a shadow boundary, so the palette still
// reaches the block. Everything else has to be handed over deliberately.
const SHADOW_BASE = `:host{all:initial;display:block;font-family:var(--sans);` +
  `font-size:0.9rem;line-height:1.5;color:var(--ink)}` +
  `*,*::before,*::after{box-sizing:border-box}`;

// For an svg or xml block only, never an html one.
//
// Two things were lost when these blocks moved behind the boundary. The sanitised
// markup used to be the direct child of `.embed`, which is a flex container, and
// it was sized by `.embed svg, .embed img` in the page's own stylesheet. Neither
// survived: a page rule does not cross a shadow boundary, and the holder div
// became the flex item in the SVG's place.
//
// That combination is what made every diagram in this project render as an empty
// box. An `<svg>` carrying only a `viewBox` has an aspect ratio but no intrinsic
// width, and as a grandchild of the flex container it had nothing definite to
// resolve `width: auto` against — the holder's own width came from its content,
// which was the SVG. Measured in Chromium: 0×0. `display: contents` removes the
// holder's box so the markup is the flex item again, which gives the SVG the
// container's width to work from, and the sizing rule below is the page rule
// moved in behind the boundary. Measured after: 590×194 for a 640×210 viewBox in
// a 590px column, and an SVG with explicit width/height is left at its own size.
//
// Deliberately not applied to html blocks. Their holder has to stay one block:
// `display: contents` would make each top-level element of the block a separate
// flex item, laid out in a row, and the sizing rule would blockify an `<img>`
// out of the sentence it was written into.
const MARKUP_SHADOW_CSS = `.markup{display:contents}` +
  `svg,img{max-width:100%;height:auto;display:block}`;

// DOMPurify drops <style> even with ADD_TAGS, so the CSS is lifted out before
// the markup is sanitised and handled on its own terms. That is safe here only
// because the result goes into a shadow root: the rules cannot reach the
// application around the block, so what is left to guard against is CSS that
// talks to the network or resurrects legacy script vectors.
const CSS_FILTERS = [
  [/@import[^;]*;?/gi, ""],
  [/expression\s*\(/gi, "("],
  [/behaviou?r\s*:/gi, "x:"],
  [/url\(\s*(?!["']?data:image\/)[^)]*\)/gi, "none"],
];

function safeCss(css) {
  let out = css;
  for (const [re, to] of CSS_FILTERS) out = out.replace(re, to);
  return out;
}

/**
 * Split a markup block into its style rules and the markup around them.
 *
 * The closing tag is optional on purpose. Requiring `</style>` left
 * `<style>@import url("//host/x.css")` with no close tag unlifted: it reached
 * DOMPurify, which allows <style>, and applied unfiltered. An unterminated
 * <style> runs to the end of the block in a real parser too, so lifting it to
 * the end of the source is also the correct reading.
 */
function splitStyles(source) {
  const css = [];
  const html = source.replace(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi, (_, body) => {
    css.push(body);
    return "";
  });
  return { html, css: safeCss(css.join("\n")) };
}

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
function blockShell(inner, kind, view) {
  const outer = document.createElement("div");
  outer.className = "embed-shell cm-block";
  outer.appendChild(inner);
  outer.appendChild(makeBlockButton(kind, null, view));
  return outer;
}

/**
 * The one button the hover toolbar carries. It opens the same composer a
 * text selection does, anchored to the whole block rather than a phrase —
 * the only way to comment on a diagram or image, since there is no text in
 * one to select. It needs to appear on the block the pointer is over and
 * stay out of the way otherwise.
 *
 * blockId, when given, is the id attachBlockButtonHover uses to find this
 * button from any of the block's OTHER lines — see that function for why.
 */
function makeBlockButton(kind, blockId, view) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "blockbtn";
  btn.title = "Comment on this " + kind;
  btn.textContent = "comment";
  if (blockId != null) btn.dataset.block = blockId;
  // CodeMirror places the cursor on mousedown, not click — stopping only the
  // click left that mousedown free to bubble into the editor and land a
  // selection inside the block, which reverts a rendered diagram or table
  // back to source the moment its own button is clicked.
  btn.onmousedown = (e) => e.stopPropagation();
  btn.onclick = (e) => {
    e.stopPropagation();
    openBlockComposer(view, btn);
  };
  return btn;
}

class MermaidWidget extends WidgetType {
  constructor(source) { super(); this.source = source; this.key = "mermaid:" + source; }
  eq(other) { return other.source === this.source; }
  get estimatedHeight() { return BLOCK_HEIGHTS.get(this.key) ?? DEFAULT_BLOCK_HEIGHT.mermaid; }
  toDOM(view) {
    const wrap = document.createElement("div");
    wrap.className = "embed embed-mermaid";
    wrap.textContent = "rendering diagram…";
    const shell = blockShell(wrap, "fence", view);
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
    const shell = blockShell(wrap, "fence", view);
    remeasureOnResize(shell, view, this.key);
    try {
      // One path for every kind. html, svg and xml are all author-written
      // markup from a document anyone with the link can edit, so all three get
      // the CSS lift, the filter, and the shadow boundary. Only the layout
      // differs, and only because an svg block's box tree used to be different
      // (see MARKUP_SHADOW_CSS). RENDERABLE maps both svg and xml to "svg".
      const isMarkupImage = this.kind === "svg";
      const { html, css } = splitStyles(this.source);
      const holder = document.createElement("div");
      if (isMarkupImage) holder.className = "markup";
      holder.innerHTML = DOMPurify.sanitize(html, CLEAN);
      // Anything that still arrives as a <style> — a construction the lift did
      // not recognise — is scoped by the shadow root but was never filtered.
      // Filter it in place rather than trust the regex to have caught it all.
      for (const leftover of holder.querySelectorAll("style")) {
        leftover.textContent = safeCss(leftover.textContent);
      }
      // Before attachShadow, not after: a shadow root on wrap hides the error
      // message the catch below writes into it.
      if (!holder.innerHTML.trim()) throw new Error("nothing left after sanitising");
      const root = wrap.attachShadow({ mode: "open" });
      const sheet = document.createElement("style");
      sheet.textContent = SHADOW_BASE + (isMarkupImage ? MARKUP_SHADOW_CSS : "") + "\n" + css;
      root.appendChild(sheet);
      root.appendChild(holder);
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
    const shell = blockShell(wrap, "image", view);
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
// ---- tables -----------------------------------------------------------------
// GFM tables are parsed (the Table extension above) and then replaced with a real
// HTML table, the same way diagrams are: rendered while the cursor is elsewhere,
// reverting to pipes the moment you click into it. Without this a spec full of
// tables reads as a wall of punctuation, which rather defeats the point.

/** Split one markdown table row into cells, honouring escaped pipes. */
function splitRow(line) {
  const cells = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "|") { cells.push(cur); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur);
  if (cells.length && cells[0].trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

const ALIGN = (spec) => {
  const s = spec.trim();
  const l = s.startsWith(":"), r = s.endsWith(":");
  return l && r ? "center" : r ? "right" : "left";
};

/** The small subset of inline markdown worth honouring inside a cell. */
function inlineHTML(src) {
  const esc = src
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

class TableWidget extends WidgetType {
  constructor(source) { super(); this.source = source; this.key = "table:" + source; }
  eq(other) { return other.source === this.source; }
  ignoreEvent() { return false; }
  get estimatedHeight() {
    const rows = this.source.split("\n").filter((l) => l.trim()).length;
    return BLOCK_HEIGHTS.get(this.key) ?? Math.max(80, rows * 38 + 24);
  }
  toDOM(view) {
    const wrap = document.createElement("div");
    wrap.className = "embed embed-table";
    const shell = blockShell(wrap, "table", view);
    remeasureOnResize(shell, view, this.key);
    try {
      const lines = this.source.split("\n").filter((l) => l.trim() !== "");
      if (lines.length < 2) throw new Error("not a table");
      const head = splitRow(lines[0]);
      const align = splitRow(lines[1]).map(ALIGN);
      const body = lines.slice(2).map(splitRow);
      const cell = (tag, text, i) =>
        "<" + tag + ' style="text-align:' + (align[i] || "left") + '">' +
        inlineHTML(text) + "</" + tag + ">";
      const html =
        "<table><thead><tr>" +
        head.map((h, i) => cell("th", h, i)).join("") +
        "</tr></thead><tbody>" +
        body.map((r) => "<tr>" + r.map((c, i) => cell("td", c, i)).join("") + "</tr>").join("") +
        "</tbody></table>";
      wrap.innerHTML = DOMPurify.sanitize(html, CLEAN);
    } catch (e) {
      wrap.className = "embed embed-error";
      wrap.textContent = "table could not be rendered: " + e.message;
    }
    return shell;
  }
}

// ---- block rhythm -----------------------------------------------------------
// Headings and rules need air around them or the document reads as one slab.
// This is padding on the line, never margin: CodeMirror measures a line's height
// from its element, and padding is included where margin is not.

const BLOCK_LINE = {
  ATXHeading1: "cm-h1", ATXHeading2: "cm-h2", ATXHeading3: "cm-h3",
  ATXHeading4: "cm-h4", ATXHeading5: "cm-h4", ATXHeading6: "cm-h4",
  HorizontalRule: "cm-hr", Blockquote: "cm-quote",
};

function buildLineStyles(state) {
  const builder = new RangeSetBuilder();
  const marks = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      const cls = BLOCK_LINE[node.name];
      if (!cls) return;
      const line = state.doc.lineAt(node.from);
      marks.push([line.from, cls]);
    },
  });
  marks.sort((a, b) => a[0] - b[0]);
  let last = -1;
  for (const [pos, cls] of marks) {
    if (pos === last) continue;
    last = pos;
    builder.add(pos, pos, Decoration.line({ class: cls }));
  }
  return builder.finish();
}

const lineStyles = StateField.define({
  create: (state) => buildLineStyles(state),
  update(deco, tr) {
    return tr.docChanged ? buildLineStyles(tr.state) : deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

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
      } else if (node.name === "Table") {
        if (touched(node.from, node.to)) return;
        widgets.push(
          Decoration.replace({ widget: new TableWidget(state.doc.sliceString(node.from, node.to)), block: true })
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

// ---- hover comment toolbar ---------------------------------------------------
// One block, one section: blockRanges (client/blocks.js) is a plain scan over
// the document text, independent of the syntax tree renderBlocks above uses.
// A diagram, table or image currently rendered as a widget already gets its
// hover button from blockShell — its whole DOM is one element, so plain CSS
// hover covers it. Everything else (a heading, a paragraph, a list, a fence
// not rendered as one of those, or any of those blocks while its source is
// being edited and hasn't reverted to a widget) is still plain source lines,
// and gets decorated here instead: every line the block spans carries the
// "cm-block" class, but the button widget sits on the first line only.
//
// A multi-line block's lines are separate DOM siblings, so hovering line two
// of a paragraph does not trigger CSS :hover on line one — a sibling's
// descendant is invisible to :hover. Each line instead carries a data-block
// id shared across the whole block, and attachBlockButtonHover below mirrors
// the hover state from whichever line the pointer is over onto that block's
// one button.
class BlockButtonWidget extends WidgetType {
  constructor(kind, blockId) { super(); this.kind = kind; this.blockId = blockId; }
  eq(other) { return other.kind === this.kind && other.blockId === this.blockId; }
  toDOM(view) { return makeBlockButton(this.kind, this.blockId, view); }
}

function buildBlockToolbar(state) {
  const rendered = state.field(renderBlocks);
  const items = [];
  for (const b of blockRanges(state.doc.toString())) {
    // Skip a block renderBlocks is currently replacing with a widget — those
    // source lines aren't in the DOM at all, so decorating them would either
    // do nothing or (worse) rely on CodeMirror silently discarding the
    // overlap. blockShell already gave that widget its own button.
    let covered = false;
    rendered.between(b.from, b.to, () => { covered = true; return false; });
    if (covered) continue;

    const id = String(b.from);
    for (let pos = b.from; ; ) {
      const line = state.doc.lineAt(pos);
      items.push(Decoration.line({ class: "cm-block", attributes: { "data-block": id } }).range(line.from));
      if (line.to >= b.to) break;
      pos = line.to + 1;
    }
    items.push(Decoration.widget({ widget: new BlockButtonWidget(b.kind, id), side: 1 }).range(b.from));
  }
  return Decoration.set(items, true);
}

// A StateField, not a ViewPlugin — the same reason renderBlocks above is one.
// Recomputes on selection too, not just doc changes: which blocks renderBlocks
// currently covers (the `rendered` lookup above) depends on the cursor —
// clicking into a table reverts it to raw source without touching the doc.
const blockToolbar = StateField.define({
  create: (state) => buildBlockToolbar(state),
  update(deco, tr) {
    return (tr.docChanged || tr.selection) ? buildBlockToolbar(tr.state) : deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Bridge the hover gap CSS can't close: a multi-line block's second and
 * later lines are DOM siblings of the line holding the button, so hovering
 * them cannot reveal it through `:hover` alone. This mirrors the hover state
 * onto the block's actual button by matching the shared data-block id.
 */
function attachBlockButtonHover(view) {
  let active = null;
  const clear = () => { if (active) { active.classList.remove("blockbtn-hover"); active = null; } };
  view.dom.addEventListener("mouseover", (e) => {
    const host = e.target instanceof Element ? e.target.closest("[data-block]") : null;
    const btn = host ? view.dom.querySelector('.blockbtn[data-block="' + host.dataset.block + '"]') : null;
    if (btn === active) return;
    clear();
    if (btn) { btn.classList.add("blockbtn-hover"); active = btn; }
  });
  view.dom.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget || !(e.relatedTarget instanceof Node) || !view.dom.contains(e.relatedTarget)) clear();
  });
}

// ---- the active block outline -----------------------------------------------
// A single element that tracks whichever block holds the caret, drawn as an
// outline so it costs no layout: a border would shift the text every time it
// appeared, and margins on block-level things in this file have twice
// desynchronised CodeMirror's height map and made clicks land low.
//
// This is a `layer`, the same primitive drawSelection uses. Two properties come
// free from that and both matter here: the marker is absolutely positioned, so
// it is outside layout entirely, and RectangleMarker reuses its DOM element
// when only the geometry changes — which is what lets a CSS transition slide
// the outline from one block to the next instead of blinking between them.
//
// Blocks span several lines, so one outline per line would draw a box per line.
// A single moving rectangle is the only shape that frames a block.

const OUTLINE_PAD = 4;

const activeBlockOutline = layer({
  above: false,
  class: "cm-blockOutlineLayer",
  update: (u) => u.docChanged || u.selectionSet || u.geometryChanged,
  markers(view) {
    const sel = view.state.selection.main;
    // While selecting across text the selection itself is the feedback; a block
    // frame on top of it is noise.
    if (!sel.empty) return [];
    const block = blockAt(blockRanges(view.state.doc.toString()), sel.head);
    if (!block) return [];
    const first = view.lineBlockAt(block.from);
    const last = view.lineBlockAt(Math.min(block.to, view.state.doc.length));
    // The height map measures from the top of the content area; a layer marker
    // is positioned against the content element's padding box. Those differ by
    // exactly the content's top padding, which is 2.6rem here — measured rather
    // than hardcoded, because the padding is set in the theme above and would
    // silently drift out of step with a literal.
    const cs = getComputedStyle(view.contentDOM);
    const offsetTop = parseFloat(cs.paddingTop) || 0;
    const offsetLeft = parseFloat(cs.paddingLeft) || 0;
    const width = view.contentDOM.clientWidth - offsetLeft * 2;
    return [
      new RectangleMarker(
        "cm-blockOutline",
        offsetLeft,
        offsetTop + first.top - OUTLINE_PAD,
        width,
        last.bottom - first.top + OUTLINE_PAD * 2,
      ),
    ];
  },
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
  // The layer holds one absolutely-positioned marker: no layout cost, and no
  // pointer target, so clicking through it lands in the text as before.
  ".cm-blockOutlineLayer": { pointerEvents: "none" },
  ".cm-blockOutline": {
    outline: "1.5px solid var(--accent)",
    outlineOffset: "0px",
    borderRadius: "4px",
    opacity: "0.5",
    pointerEvents: "none",
    transition: "top 130ms cubic-bezier(.2,.8,.2,1), height 130ms cubic-bezier(.2,.8,.2,1)",
  },
  "@media (prefers-reduced-motion: reduce)": {
    ".cm-blockOutline": { transition: "none" },
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  // drawSelection() suppresses the native caret and paints its own
  // .cm-cursor, so the caretColor above is inert. CodeMirror's base theme
  // then colours that element from its light defaults, because this theme is
  // not declared dark -- a black caret, invisible on the dark palette and
  // easy to lose on the light one. Colour it from the token so it is visible
  // in both, and widen it slightly: at this measure a 1.2px caret is hard to
  // find in a wall of serif text.
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--ink)", borderLeftWidth: "2px",
  },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-bg) !important" },
  // contain is a containment boundary, not decoration. A shadow root scopes
  // selectors but not layout: :host{position:fixed;inset:0;z-index:9999} in a
  // block's own CSS overrides SHADOW_BASE's :host, and #editor's
  // position:relative is not a containing block for a fixed-position
  // descendant, so the block could paint over the whole application. Layout
  // containment makes this shell that containing block; paint containment clips
  // to it. Neither can be reached from inside the shadow tree. Deliberately not
  // `contain: size` — CodeMirror measures this element's height.
  ".embed-shell": { padding: "1.1rem 0", contain: "layout paint" },
  // The hover comment toolbar. cm-block marks the hoverable area — either a
  // plain-text line (heading, paragraph, list) or an .embed-shell (diagram,
  // table, image) — and the button lives inside it, revealed on :hover.
  // Positioned absolute, so it adds no height of its own; only .embed-shell's
  // own padding above sets the block's rhythm.
  ".cm-block": { position: "relative" },
  ".cm-block .blockbtn": {
    position: "absolute", right: "0", top: "0", opacity: "0",
    transition: "opacity .12s", fontFamily: "var(--mono)", fontSize: ".6rem",
    color: "var(--accent-ink)", background: "var(--accent-bg)",
    border: "1px solid var(--accent)", borderRadius: "3px",
    padding: ".1rem .35rem", cursor: "pointer", zIndex: "1",
  },
  ".cm-block:hover .blockbtn": { opacity: "1" },
  // Set by attachBlockButtonHover for lines after the block's first, where
  // plain :hover can't reach the button (see the comment on that function).
  ".blockbtn.blockbtn-hover": { opacity: "1" },
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
  ".cm-h1": { paddingTop: "1.5rem", paddingBottom: "0.35rem" },
  ".cm-h2": { paddingTop: "1.9rem", paddingBottom: "0.3rem" },
  ".cm-h3": { paddingTop: "1.3rem", paddingBottom: "0.2rem" },
  ".cm-h4": { paddingTop: "1rem" },
  ".cm-hr": { paddingTop: "0.6rem", paddingBottom: "0.6rem" },
  ".cm-quote": { paddingLeft: "0.9rem", borderLeft: "2px solid var(--rule)" },
  ".embed-table": {
    display: "block", padding: "0", background: "transparent",
    border: "none", cursor: "pointer", overflowX: "auto",
  },
  ".embed-table table": {
    borderCollapse: "collapse", width: "100%",
    fontFamily: "var(--sans)", fontSize: "0.82rem", lineHeight: "1.45",
  },
  ".embed-table th": {
    textAlign: "left", fontWeight: "650", color: "var(--soft)",
    fontFamily: "var(--mono)", fontSize: "0.62rem", letterSpacing: "0.09em",
    textTransform: "uppercase", padding: "0 0.7rem 0.45rem 0",
    borderBottom: "1px solid var(--rule)", whiteSpace: "nowrap",
  },
  ".embed-table td": {
    padding: "0.5rem 0.7rem 0.5rem 0", verticalAlign: "top",
    borderBottom: "1px solid var(--rule)", color: "var(--ink)",
  },
  ".embed-table tr:last-child td": { borderBottom: "none" },
  ".embed-table code": {
    fontFamily: "var(--mono)", fontSize: "0.86em",
    background: "var(--accent-bg)", color: "var(--accent-ink)",
    padding: "0.05em 0.3em", borderRadius: "3px",
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
      activeBlockOutline,
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage, extensions: [Table, Strikethrough, TaskList] }),
      syntaxHighlighting(liveStyle),
      hideMarkers,
      lineStyles,
      renderBlocks,
      blockToolbar,
      highlightField,
      theme,
      yCollab(content, awareness, { undoManager }),
      // The outline rail (below) and the comment margin both need to know
      // when the document itself changes, not just when comments do — a new
      // heading or a moved one has to reach the rail. scheduleLayout is
      // already rAF-debounced, so routing this through it coalesces a burst
      // of keystrokes into one repaint per frame instead of one per change.
      EditorView.updateListener.of((u) => { if (u.docChanged) scheduleLayout(); }),
    ],
  }),
});
attachBlockButtonHover(view);

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

// An agent is "attached" the moment some other awareness state carries an
// "agent" field — there is no separate server-side boolean for this. That
// state is `{ busy: false }` when idle, `{ busy: true, comment_id }` when
// notified about one thread, or `{ busy: true }` while working a batched
// review, so it doubles as the source for the #thinking indicator.
function renderAgentPresence() {
  let agent = null;
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === doc.clientID) return;
    if (state.agent) agent = state.agent;
  });
  el("agentdot").className = "dot " + (agent ? "on" : "off");
  el("agentstate").textContent = agent ? "agent attached" : "no agent attached";
  el("agentstate").classList.toggle("muted", !agent);
  setAgentBusy(Boolean(agent && agent.busy), agent && agent.comment_id);
}
awareness.on("change", renderAgentPresence);
renderAgentPresence();

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
// Three anchor states, not two — see src/anchor.ts for why. Both non-ok states
// are treated as detached here, and neither highlights the document. The
// comparison itself is shared with the agent's companion rather than
// re-implemented, so the two clients cannot disagree about what a comment means.

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

function commentViews() {
  const out = [];
  const docText = view.state.doc;
  for (const m of comments) {
    const from = resolveAnchor(m.get("anchorFrom"));
    const to = resolveAnchor(m.get("anchorTo"));
    const replies = m.get("replies");
    const quote = m.get("quote") || "";

    const anchor = anchorState(from, to, quote, (f, t) =>
      docText.sliceString(f, Math.min(t, f + 2000)));
    const current = anchor.current;
    const state = anchor.state === "ok" ? (m.get("resolved") ? "resolved" : "open") : anchor.state;
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

  const scope = document.createElement("span");
  scope.className = "cmt-scope";
  scope.textContent = c.map.get("scope") === "block" ? "block" : "quote";
  card.appendChild(scope);

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

// The rail counts a comment against a section only while it is unresolved and
// still anchored to real text — a resolved or detached comment (its text
// deleted or changed out from under it, see commentViews above) tells a
// reader nothing about where to look next. resolveAnchor already lives inside
// commentViews' pass over the comment array, so this reuses that rather than
// resolving anchors a second way.
function unresolvedCommentPositions() {
  return commentViews()
    .filter((c) => !c.resolved && !c.detached && c.from !== null)
    .map((c) => c.from);
}
const paintRail = mountRail(el("rail"), view, () => content.toString(), unresolvedCommentPositions);

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
      "Select any text to comment on it.<br>Say <b>@claude</b> to ask the session now, or leave notes and press <b>send to claude</b> when you are done.";
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
  requestAnimationFrame(() => { layoutQueued = false; layoutCards(); paintRail(); });
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
  ta.placeholder = "Reply. Mention @claude to reach the session now.";
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
// "quote" from a text selection, "block" from a block's comment button — see
// the composer's cadd handler below, where it is written onto the map.
let pendingScope = "quote";

function hideComposer() {
  composer.style.display = "none";
  pending = null;
}

view.dom.addEventListener("mouseup", () => {
  const sel = view.state.selection.main;
  if (sel.empty) { hideComposer(); return; }
  pending = { from: sel.from, to: sel.to };
  pendingScope = "quote";
  const coords = view.coordsAtPos(sel.head) || view.coordsAtPos(sel.from);
  composer.style.display = "block";
  const top = Math.min((coords ? coords.bottom : 200) + 8, window.innerHeight - 190);
  composer.style.top = Math.max(60, top) + "px";
  composer.style.left =
    Math.max(16, Math.min(coords ? coords.left : 100, window.innerWidth - 660)) + "px";
  el("ctext").focus();
});

/**
 * Opens the same composer a text selection does, but anchored to a whole
 * block rather than a phrase — this is what a block's comment button (both
 * the plain-line blockbtn and the widget's blockShell button) wires to.
 *
 * The button's own position is found afresh via posAtDOM rather than trusting
 * anything cached on the widget: a widget can be reused across an edit
 * (unchanged source keeps the same JS instance, per its eq()), so any from/to
 * captured at construction time would go stale the moment something above the
 * block shifted its position. blockRanges is the same source of truth
 * buildBlockToolbar already uses, so the two agree on where a block starts
 * and ends.
 */
function openBlockComposer(view, btn) {
  const pos = view.posAtDOM(btn);
  const block = blockRanges(view.state.doc.toString()).find((b) => pos >= b.from && pos <= b.to);
  if (!block) return;
  pending = { from: block.from, to: block.to };
  pendingScope = "block";
  const rect = btn.getBoundingClientRect();
  composer.style.display = "block";
  const top = Math.min(rect.bottom + 8, window.innerHeight - 190);
  composer.style.top = Math.max(60, top) + "px";
  composer.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 660)) + "px";
  el("ctext").focus();
}

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
    m.set("scope", pendingScope);
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

// ---- pulling the agent in ---------------------------------------------------
// Comments are silent. Nothing reaches the attached session until someone presses
// send, so a person can read the whole document and leave twenty notes without
// the agent rewriting paragraphs underneath them. One press delivers the batch.

function pendingForAgent() {
  const out = [];
  for (const m of comments) {
    if (m.get("resolved")) continue;
    const replies = m.get("replies");
    const last = replies && replies.length ? replies.get(replies.length - 1) : null;
    const who = last ? last.author : m.get("author");
    if (isAgent(who)) continue;
    out.push(m.get("id"));
  }
  return out;
}

function refreshSend() {
  const btn = el("sendclaude");
  if (!btn) return;
  const n = pendingForAgent().length;
  btn.disabled = n === 0;
  btn.textContent = n === 0 ? "send to claude" : `send to claude · ${n}`;
  btn.title =
    n === 0
      ? "Nothing waiting. Untagged comments gather here until you send them."
      : `Send ${n} unanswered comment${n === 1 ? "" : "s"} to the session as one review`;
}

function sendToClaude() {
  const ids = pendingForAgent();
  if (!ids.length) return;
  meta.set("review", {
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    by: ME,
    at: new Date().toISOString(),
    count: ids.length,
  });
  const btn = el("sendclaude");
  btn.disabled = true;
  btn.textContent = "sent";
  setTimeout(refreshSend, 2500);
}

el("sendclaude").onclick = sendToClaude;
comments.observeDeep(refreshSend);
refreshSend();
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
