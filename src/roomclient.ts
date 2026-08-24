// The agent's connection to a room, over the same websocket protocol the
// browser uses (src/web.ts, src/frames.ts). It applies remote document
// updates to its own Y.Doc and forwards local updates to the server; the
// "remote" origin on applyUpdate keeps that from becoming an echo loop, since
// the update handler below drops anything tagged with it.
//
// The connection is the room. When the socket drops — a room-server restart is
// the ordinary case here — this client still holds a fully populated Y.Doc, and
// a send on a closed socket is silently discarded rather than throwing. Left
// unguarded that turned the agent into a private fork of the document: reads
// answered from a stale snapshot, writes reported as landed while they reached
// nobody, and every later edit matched against text that existed in no other
// process. So liveness is tracked, and every write refuses while it is false.
//
// Nothing is queued for replay. After a restart the server's state has moved
// on, and replaying a backlog blind is exactly the whole-document clobber the
// edit-only tool surface exists to prevent. Reattaching is room_join's job.
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { tag, untag, DOC_MSG, AWARE_MSG } from "./frames";
import { locate } from "./room";

export const NOT_CONNECTED = "not connected to the room server — call room_join again";

export class RoomClient {
  readonly doc = new Y.Doc();
  readonly content = this.doc.getText("content");
  readonly comments = this.doc.getArray<Y.Map<unknown>>("comments");
  readonly meta = this.doc.getMap<any>("meta");
  readonly awareness = new Awareness(this.doc);

  private live = true;

  private constructor(private ws: WebSocket, readonly roomId: string) {
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || !this.live) return;
      this.ws.send(tag(DOC_MSG, update));
    });
    this.awareness.on("update", ({ added, updated, removed }: any, origin: unknown) => {
      if (origin === "remote" || !this.live) return;
      const changed = added.concat(updated, removed);
      this.ws.send(tag(AWARE_MSG, encodeAwarenessUpdate(this.awareness, changed)));
    });
  }

  /** False once the socket has closed. Every write checks it, and so should any caller about to claim an edit landed. */
  get connected() { return this.live; }

  static connect(base: string, roomId: string): Promise<RoomClient> {
    return new Promise((resolve, reject) => {
      // The server may be behind a shared-secret gate. cloudflared reaches it
      // over loopback, so loopback cannot be exempt — which means the agent has
      // to authenticate like any other client. A bearer header rather than a
      // cookie, because this side has no cookie jar.
      const secret = process.env.SPEC_ROOM_SECRET;
      const ws = new WebSocket(
        `${base}/ws?room=${roomId}`,
        secret ? ({ headers: { authorization: `Bearer ${secret}` } } as any) : undefined,
      );
      ws.binaryType = "arraybuffer";
      const client = new RoomClient(ws, roomId);
      let settled = false;
      ws.onmessage = (e) => {
        const { kind, payload } = untag(new Uint8Array(e.data as ArrayBuffer));
        if (kind === DOC_MSG) {
          Y.applyUpdate(client.doc, payload, "remote");
          if (!settled) { settled = true; resolve(client); }
        } else if (kind === AWARE_MSG) {
          applyAwarenessUpdate(client.awareness, payload, "remote");
        }
      };
      ws.onerror = () => { if (!settled) reject(new Error("cannot reach the room server")); };
      ws.onclose = () => {
        client.live = false;
        // A close before the first state frame is a join that never happened —
        // an unknown room id is refused at the upgrade — not a live room going
        // quiet, so it has to reject rather than leave the promise pending.
        if (!settled) { settled = true; reject(new Error("cannot reach the room server")); }
      };
    });
  }

  text() { return this.content.toString(); }

  edit(needle: string, replacement: string) {
    if (!this.live) return { ok: false, reason: NOT_CONNECTED };
    const text = this.text();
    const hit = locate(text, needle);
    if (hit.at === -1) return { ok: false, reason: hit.reason };
    // Documents are stored LF-only, but locate() deliberately matches an LF
    // needle against a CRLF document — so an un-normalised replacement lands
    // LF-only inside CRLF text and leaves it mixed, after which the next
    // multi-line edit fails as "text not found". Room.edit and both
    // insertAfter variants normalise; this is the last write path that did not.
    const body = text.includes("\r\n") ? replacement.replace(/\r?\n/g, "\r\n") : replacement;
    this.doc.transact(() => {
      this.content.delete(hit.at, hit.len);
      this.content.insert(hit.at, body);
    });
    return { ok: true };
  }

  append(markdown: string) {
    if (!this.live) return { ok: false, reason: NOT_CONNECTED };
    this.content.insert(this.content.length, (this.content.length ? "\n\n" : "") + markdown);
    return { ok: true };
  }

  insertAfter(needle: string, markdown: string) {
    if (!this.live) return { ok: false, reason: NOT_CONNECTED };
    const text = this.text();
    const hit = locate(text, needle);
    if (hit.at === -1) return { ok: false, reason: hit.reason };
    const body = text.includes("\r\n") ? markdown.replace(/\r?\n/g, "\r\n") : markdown;
    this.content.insert(hit.at + hit.len, body);
    return { ok: true };
  }

  /** Publish this client's presence (e.g. `{ busy }`) under the "agent" awareness field, so the browser can tell an attached agent from a human "user" state. */
  setPresence(fields: Record<string, unknown>) {
    this.awareness.setLocalStateField("agent", fields);
  }

  close() {
    this.live = false;
    this.awareness.destroy();
    this.ws.close();
  }
}
