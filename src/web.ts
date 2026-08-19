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
import { Rooms } from "./rooms";
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

/**
 * Start the web server, walking forward if the port is taken.
 *
 * Never throws. A stale instance holding the port used to bring the whole
 * process down with it, and because the MCP transport lives in this same
 * process that surfaced to Claude Code as CONNECTION_CLOSED with no clue why.
 * The document tools matter more than the browser UI, so a failure here is
 * reported and survived rather than fatal.
 */
export function startWeb(rooms: Rooms, port: number, attempts = 10): { port: number; stop(): void } | null {
  for (let i = 0; i < attempts; i++) {
    try {
      const server = Bun.serve<Sock>({
        port: port + i,
        hostname: "127.0.0.1",
        idleTimeout: 0,
        async fetch(req, srv) {
          const url = new URL(req.url);

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
            return new Response(html(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
          }

          if (url.pathname === "/api/rooms") return Response.json(rooms.list());

          if (url.pathname === "/" || url.pathname === "/index.html") {
            return new Response(html(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
        process.stderr.write(`spec-room: port ${port} busy, using ${server.port}\n`);
      }
      return { port: server.port, stop: () => server.stop(true) };
    } catch (e: any) {
      if (e?.code !== "EADDRINUSE") {
        process.stderr.write(`spec-room: web server failed to start: ${e}\n`);
        return null;
      }
    }
  }
  process.stderr.write(
    `spec-room: no free port in ${port}-${port + attempts - 1}; ` +
      `document tools still work, browser UI unavailable\n`,
  );
  return null;
}
