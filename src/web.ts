// HTTP + WebSocket for the browser side.
//
// The sync protocol is deliberately tiny: binary frames are Yjs updates, text
// frames are presence JSON. On connect the server sends the whole document
// state; after that both sides just exchange updates. Yjs updates are
// commutative and idempotent, so this is all the protocol needs to be.
import * as Y from "yjs";
import { doc } from "./doc";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const INDEX = join(dirname(import.meta.dir), "public", "index.html");

type Sock = { send: (d: any) => void; data: { id: number } };

const sockets = new Set<any>();
let agentPresent = false;

export function setAgentPresent(v: boolean) {
  if (agentPresent === v) return;
  agentPresent = v;
  broadcastPresence();
}

function broadcastPresence() {
  const msg = JSON.stringify({
    type: "presence",
    humans: sockets.size,
    agent: agentPresent,
  });
  for (const ws of sockets) {
    try { ws.send(msg); } catch { /* closing */ }
  }
}

doc.on("update", (update: Uint8Array, origin: unknown) => {
  for (const ws of sockets) {
    if (ws === origin) continue;
    try { ws.send(update); } catch { /* closing */ }
  }
});

function listen(port: number) {
  const html = () => readFileSync(INDEX, "utf8");

  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        return server.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(html(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        ws.send(Y.encodeStateAsUpdate(doc));
        broadcastPresence();
      },
      message(ws, msg) {
        if (typeof msg === "string") return;
        Y.applyUpdate(doc, new Uint8Array(msg as ArrayBuffer), ws);
      },
      close(ws) {
        sockets.delete(ws);
        broadcastPresence();
      },
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
export function startWeb(port: number, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    try {
      const server = listen(port + i);
      if (i > 0) {
        process.stderr.write(`spec-room: port ${port} busy, using ${port + i}\n`);
      }
      return server;
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
