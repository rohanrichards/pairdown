// HTTP + WebSocket for the browser side, serving every room from one process.
//
// The sync protocol is deliberately tiny: binary frames are tagged with a
// one-byte kind (see src/frames.ts) so document updates and awareness
// (cursor/presence) share one socket. On connect the server sends the room's
// whole document state; after that both sides just exchange updates. Yjs
// updates are commutative and idempotent, so this is all the protocol needs
// to be.
//
// One process now holds many rooms. Each socket is tagged with the room it
// joined at upgrade time, and Bun's pub/sub keeps every room's traffic
// isolated: a client only ever receives frames published to its own room's
// topic.
import * as Y from "yjs";
import { Rooms, type RoomInfo } from "./rooms";
import {
  gateEnabled, authorised, sessionCookie, gatePage, isHttps, safeReturnTo, safeEqual,
} from "./gate";
import { tag, untag, DOC_MSG } from "./frames";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = dirname(import.meta.dir);
const INDEX = join(ROOT, "public", "index.html");
const JS_DIR = join(ROOT, "public", "js");

type Sock = { room: string };

function html() {
  return readFileSync(INDEX, "utf8");
}

// Room names are typed by whoever creates a room and rendered straight into
// this page's HTML — an unescaped name is stored XSS in a page every
// collaborator visits.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

function roomRow(r: RoomInfo): string {
  // r.id is always an 8-char [a-z0-9] string from newId() today, but escape
  // it anyway rather than lean on that invariant holding forever — a future
  // path that trusts an externally-supplied id would make this call site
  // silently unsafe with no local signal.
  const id = escapeHtml(r.id);
  const created = r.createdAt
    ? `<time datetime="${escapeHtml(r.createdAt)}">${escapeHtml(r.createdAt.slice(0, 10))}</time>`
    : "";
  return `<li class="room">
    <a class="room-link" href="/r/${id}">${escapeHtml(r.name)}</a>${created}
    <span class="room-id">${id}</span>
  </li>`;
}

// The room index: not the editor. It has no CRDT, no build step, and needs
// no framework — just a list of rooms and a form to create one, styled with
// the same palette as the editor so the two pages read as one product.
function indexHtml(rooms: RoomInfo[]): string {
  const list = rooms.length
    ? `<ul id="roomlist">${rooms.map(roomRow).join("")}</ul>`
    : `<p id="empty">No rooms yet — create one below.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pairdown</title>
<style>
  :root {
    --paper: #f1f4f0; --card: #fbfcfa; --ink: #171c19; --soft: #5d6662;
    --faint: #a8b0ab; --rule: #d5dbd5; --accent: #24479e; --accent-bg: #e7ecf7;
    --serif: "Newsreader", Georgia, serif;
    --sans: "Archivo", system-ui, sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #121513; --card: #191d1a; --ink: #e7ebe6; --soft: #99a39d;
      --faint: #5c655f; --rule: #2a302c; --accent: #9db8ff; --accent-bg: #1b2334;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: var(--paper); color: var(--ink);
    font-family: var(--sans); padding: 3rem 1.2rem; -webkit-font-smoothing: antialiased;
  }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-family: var(--serif); font-weight: 600; font-size: 1.7rem; margin: 0 0 1.6rem; }
  h1 span { color: var(--faint); font-weight: 500; }
  ul#roomlist { list-style: none; margin: 0 0 2rem; padding: 0; border-top: 1px solid var(--rule); }
  li.room {
    display: flex; align-items: baseline; gap: .7rem; padding: .75rem 0;
    border-bottom: 1px solid var(--rule);
  }
  .room-link { color: var(--ink); font-weight: 600; text-decoration: none; }
  .room-link:hover { color: var(--accent); text-decoration: underline; }
  .room-id, time { font-family: var(--mono); font-size: .7rem; color: var(--faint); }
  .room-id { margin-left: auto; }
  #empty { color: var(--soft); margin-bottom: 2rem; }
  form { display: flex; gap: .5rem; }
  #create-error { color: #b0453f; font-family: var(--mono); font-size: .72rem; margin: .6rem 0 0; }
  #create-error[hidden] { display: none; }
  input {
    flex: 1; font-family: var(--sans); font-size: .9rem; padding: .55rem .65rem;
    background: var(--card); color: var(--ink); border: 1px solid var(--rule); border-radius: 3px;
  }
  input:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button {
    font-family: var(--mono); font-size: .78rem; cursor: pointer;
    background: var(--accent); color: var(--paper); border: 1px solid var(--accent);
    padding: .55rem .95rem; border-radius: 3px;
  }
  button:hover { opacity: .9; }
</style>
</head>
<body>
<main>
  <h1>pair<span>down</span></h1>
  ${list}
  <form id="create-form">
    <input id="roomname-input" name="name" placeholder="Room name" autocomplete="off" required>
    <button type="submit">Create room</button>
  </form>
  <p id="create-error" hidden></p>
</main>
<script>
  document.getElementById("create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("roomname-input");
    const errorEl = document.getElementById("create-error");
    errorEl.hidden = true;
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.value }),
      });
      if (!res.ok) throw new Error("bad status " + res.status);
      const room = await res.json();
      if (!room || !room.id) throw new Error("no room id in response");
      location.href = "/r/" + room.id;
    } catch (err) {
      errorEl.textContent = "Could not create the room — try again.";
      errorEl.hidden = false;
    }
  });
</script>
</body>
</html>`;
}

// ---- response headers -------------------------------------------------------
// Both pages render markup and CSS that anyone holding a room link can write,
// so the browser is given the narrowest policy each page can actually run under.
//
// What the CSP buys and what it does not: `script-src` without 'unsafe-eval' and
// without any remote origin closes the whole "someone pasted markup into a
// shared document and it executed" class outright, and `default-src 'none'`
// means anything not listed below cannot be fetched at all. It does NOT close
// the CSS containment holes on its own — inline styles are load-bearing here
// (the page's own <style>, CodeMirror's generated theme, and every html block's
// lifted <style>), so 'unsafe-inline' has to stay in `style-src` and the shadow
// root plus `contain` in client/editor.js are still what stop a block from
// restyling the application. It does close the remote half: an @import or a
// remote url() that slipped past the CSS filter has nowhere to fetch from.
//
// The two pages differ on purpose. The editor's only script is the bundle at
// /js/editor.js, so it needs no inline script at all; the index page's create
// form is a small inline <script> and has no bundle, so it is the mirror image.
const HTML_SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

// img-src is deliberately open: a remote <img> is an accepted feature of this
// document format, in html blocks and in markdown images alike.
const EDITOR_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src * data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const INDEX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'self'",
  "base-uri 'none'",
  // The form is submitted by fetch, but leave the no-JS fallback reachable.
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const GATE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

function htmlResponse(body: string, csp: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      ...HTML_SECURITY,
    },
  });
}

/**
 * Start the web server, walking forward if the port is taken.
 *
 * Never throws. A stale instance holding the port used to bring the whole
 * process down with it, and because the MCP transport lives in this same
 * process that surfaced to Claude Code as CONNECTION_CLOSED with no clue why.
 * The document tools matter more than the browser UI, so a failure here is
 * reported and survived rather than fatal.
 */
export function startWeb(
  rooms: Rooms,
  port: number,
  attempts = 10,
  // Read from the environment by the entry point, never here. A library that
  // reaches for ambient config makes every caller's behaviour depend on what
  // happens to be exported — which silently gated every test server the first
  // time a secret was set for a demo.
  secret?: string,
): { port: number; stop(): void } | null {
  for (let i = 0; i < attempts; i++) {
    try {
      const server = Bun.serve<Sock>({
        port: port + i,
        hostname: "127.0.0.1",
        idleTimeout: 0,
        async fetch(req, srv) {
          const url = new URL(req.url);

          // The gate goes first, ahead of every route including /ws and the
          // bundle. A door that covers only some entrances is not a door, and
          // the document travels over /ws.
          if (gateEnabled(secret)) {
            if (url.pathname === "/gate") {
              if (req.method === "POST") {
                const form = await req.formData().catch(() => null);
                const key = String(form?.get("key") ?? "");
                const to = safeReturnTo(String(form?.get("to") ?? "/"));
                if (!safeEqual(key, secret)) {
                  return htmlResponse(gatePage(to, true), GATE_CSP, 401);
                }
                return new Response(null, {
                  status: 302,
                  headers: { location: to, "set-cookie": sessionCookie(secret, isHttps(req)) },
                });
              }
              return htmlResponse(gatePage(safeReturnTo(url.searchParams.get("to")), false), GATE_CSP);
            }
            if (!authorised(req, secret)) {
              // A page request is sent somewhere useful; everything else gets a
              // status it can act on rather than a page it cannot parse. Decided
              // by route, not by the Accept header — that header is the client's
              // to set, and whether the door redirects or refuses should not be.
              const isPage =
                url.pathname === "/" ||
                url.pathname === "/index.html" ||
                /^\/r\/[a-z0-9]{8}$/.test(url.pathname);
              if (isPage && req.method === "GET") {
                const to = url.pathname + url.search;
                return new Response(null, {
                  status: 302,
                  headers: {
                    location: to === "/" ? "/gate" : "/gate?to=" + encodeURIComponent(to),
                  },
                });
              }
              return new Response("unauthorised", { status: 401 });
            }
          }

          if (url.pathname === "/api/rooms" && req.method === "POST") {
            const body = await req.json().catch(() => null) as { name?: string } | null;
            const name = (body?.name ?? "").trim() || "Untitled";
            return Response.json(rooms.create(name));
          }

          if (url.pathname === "/ws") {
            const room = url.searchParams.get("room") ?? "";
            if (!rooms.get(room)) return new Response("no such room", { status: 404 });
            return srv.upgrade(req, { data: { room } })
              ? undefined
              : new Response("upgrade failed", { status: 400 });
          }

          const m = url.pathname.match(/^\/r\/([a-z0-9]{8})$/);
          if (m) {
            if (!rooms.get(m[1])) return new Response("no such room", { status: 404 });
            return htmlResponse(html(), EDITOR_CSP);
          }

          if (url.pathname === "/api/rooms") return Response.json(rooms.list());

          if (url.pathname === "/" || url.pathname === "/index.html") {
            return htmlResponse(indexHtml(rooms.list()), INDEX_CSP);
          }

          // The client is code-split, so mermaid and friends load only when a
          // document actually contains a diagram. Serve the chunks, but never
          // let a path escape public/js.
          if (url.pathname.startsWith("/js/")) {
            const name = url.pathname.slice("/js/".length);
            if (!/^[A-Za-z0-9._-]+\.js$/.test(name)) {
              return new Response("not found", { status: 404 });
            }
            try {
              return new Response(readFileSync(join(JS_DIR, name), "utf8"), {
                headers: { "Content-Type": "text/javascript; charset=utf-8" },
              });
            } catch {
              return new Response("// bundle missing - run: bun run build", {
                status: 500,
                headers: { "Content-Type": "text/javascript; charset=utf-8" },
              });
            }
          }

          return new Response("not found", { status: 404 });
        },
        websocket: {
          open(ws) {
            ws.subscribe(ws.data.room);
            const room = rooms.get(ws.data.room);
            if (!room) return; // room deleted between upgrade and open
            ws.send(tag(DOC_MSG, Y.encodeStateAsUpdate(room.doc)));
          },
          message(ws, raw) {
            if (typeof raw === "string") return;
            const { kind, payload } = untag(new Uint8Array(raw as ArrayBuffer));
            if (kind === DOC_MSG) {
              const room = rooms.get(ws.data.room);
              if (room) Y.applyUpdate(room.doc, payload);
            }
            // Awareness frames are relayed as-is; the server has no cursor of
            // its own and never applies them.
            ws.publish(ws.data.room, raw as ArrayBuffer);
          },
          close(ws) {
            ws.unsubscribe(ws.data.room);
          },
        },
      });
      if (i > 0) {
        process.stderr.write(`pairdown: port ${port} busy, using ${server.port}\n`);
      }
      return { port: server.port, stop: () => server.stop(true) };
    } catch (e: any) {
      if (e?.code !== "EADDRINUSE") {
        process.stderr.write(`pairdown: web server failed to start: ${e}\n`);
        return null;
      }
    }
  }
  process.stderr.write(
    `pairdown: no free port in ${port}-${port + attempts - 1}; ` +
      `document tools still work, browser UI unavailable\n`,
  );
  return null;
}
