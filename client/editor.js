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
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { yCollab } from "y-codemirror.next";

// ---- identity ---------------------------------------------------------------

const PALETTE = ["#2f6f5e", "#a3651f", "#7a4ba8", "#b0453f", "#2450b5", "#1f7a6f", "#964d8a"];
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
  "&": { height: "100%", fontSize: "16px", backgroundColor: "transparent", color: "var(--ink)" },
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

let busyFor = null;
function setAgentBusy(busy, commentId) {
  busyFor = busy ? commentId ?? true : null;
  el("thinking").hidden = !busy;
  render();
}

// ---- comments ---------------------------------------------------------------

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
  composer.style.left = Math.max(16, Math.min((coords ? coords.left : 100), window.innerWidth - 640)) + "px";
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

function render() {
  const host = el("comments");
  const open = [];
  for (const m of comments) open.push(m);
  if (open.length === 0) {
    host.innerHTML = '<p class="empty">Select any text to comment on it.<br>Mention <b>@claude</b> to ask the attached session.</p>';
    return;
  }
  host.innerHTML = "";
  for (const m of open) {
    const from = resolveAnchor(m.get("anchorFrom"));
    const to = resolveAnchor(m.get("anchorTo"));
    const id = m.get("id");
    const author = m.get("author") || "anonymous";

    const card = document.createElement("div");
    card.className = "c" + (m.get("forAgent") ? " agent" : "") + (m.get("resolved") ? " resolved" : "");

    const meta = document.createElement("div");
    meta.className = "meta";
    const dot = document.createElement("span");
    dot.className = "who-dot";
    dot.style.background = colorFor(author);
    meta.appendChild(dot);
    meta.appendChild(document.createTextNode(author + " · " + String(m.get("createdAt")).slice(11, 16)));
    if (m.get("forAgent")) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = busyFor === id ? "working…" : "@claude";
      if (busyFor === id) b.classList.add("working");
      meta.appendChild(b);
    }
    card.appendChild(meta);

    const q = document.createElement("div");
    q.className = "quote";
    if (from === null || to === null) {
      q.innerHTML = '<span class="lost">anchor lost — the text was deleted</span>';
    } else {
      q.textContent = view.state.doc.sliceString(from, Math.min(to, from + 140)) || "(empty)";
      q.onclick = () => {
        view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
        view.focus();
      };
    }
    card.appendChild(q);

    const body = document.createElement("div");
    body.className = "body";
    body.textContent = m.get("body");
    card.appendChild(body);

    const replies = m.get("replies");
    for (const r of (replies && replies.toArray ? replies.toArray() : [])) {
      const rd = document.createElement("div");
      rd.className = "reply";
      const who = document.createElement("b");
      who.textContent = r.author;
      rd.appendChild(who);
      rd.appendChild(document.createTextNode(" " + r.body));
      card.appendChild(rd);
    }

    const btn = document.createElement("button");
    btn.className = "ghost small";
    btn.textContent = m.get("resolved") ? "reopen" : "resolve";
    btn.onclick = () => m.set("resolved", !m.get("resolved"));
    card.appendChild(btn);

    host.appendChild(card);
  }
}

comments.observeDeep(render);
content.observe(render);
render();
