// The browser half: a collaborative markdown editor with live-preview styling,
// remote cursors, and comments anchored to positions that survive editing.
//
// The document stays plain markdown in a Y.Text. That matters: the agent's
// edit_spec finds and replaces a unique passage of markdown, which only works
// while the shared document is text rather than a node tree.
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { EditorView, keymap, drawSelection, highlightActiveLine, Decoration, ViewPlugin } from "@codemirror/view";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
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

const hideMarkers = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = this.build(view); }
    update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = this.build(u.view); }
    build(view) {
      const builder = new RangeSetBuilder();
      // Leave every marker visible on the line the cursor is on, so editing the
      // syntax is still possible — the Obsidian behaviour people expect.
      const activeLines = new Set();
      for (const r of view.state.selection.ranges) {
        activeLines.add(view.state.doc.lineAt(r.head).number);
        if (r.anchor !== r.head) activeLines.add(view.state.doc.lineAt(r.anchor).number);
      }
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from, to,
          enter: (node) => {
            if (!MARKS.has(node.name)) return;
            if (activeLines.has(view.state.doc.lineAt(node.from).number)) return;
            if (node.to > node.from) builder.add(node.from, node.to, Decoration.replace({}));
          },
        });
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "16px", backgroundColor: "transparent", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--serif)", lineHeight: "1.65",
    padding: "2.6rem 0", overflow: "auto",
  },
  ".cm-content": { maxWidth: "42rem", margin: "0 auto", padding: "0 1.5rem", caretColor: "var(--ink)" },
  ".cm-line": { padding: "0" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-bg) !important" },
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
      theme,
      yCollab(content, awareness, { undoManager }),
    ],
  }),
});

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
