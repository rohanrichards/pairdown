// The agent's connection to a room, over the same websocket protocol the
// browser uses (src/web.ts, src/frames.ts). It applies remote document
// updates to its own Y.Doc and forwards local updates to the server; the
// "remote" origin on applyUpdate keeps that from becoming an echo loop, since
// the update handler below drops anything tagged with it.
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { tag, untag, DOC_MSG, AWARE_MSG } from "./frames";
import { locate } from "./room";

export class RoomClient {
  readonly doc = new Y.Doc();
  readonly content = this.doc.getText("content");
  readonly comments = this.doc.getArray<Y.Map<unknown>>("comments");
  readonly meta = this.doc.getMap<any>("meta");
  readonly awareness = new Awareness(this.doc);

  private constructor(private ws: WebSocket, readonly roomId: string) {
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      this.ws.send(tag(DOC_MSG, update));
    });
    this.awareness.on("update", ({ added, updated, removed }: any, origin: unknown) => {
      if (origin === "remote") return;
      const changed = added.concat(updated, removed);
      this.ws.send(tag(AWARE_MSG, encodeAwarenessUpdate(this.awareness, changed)));
    });
  }

  static connect(base: string, roomId: string): Promise<RoomClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base}/ws?room=${roomId}`);
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
    });
  }

  text() { return this.content.toString(); }

  edit(needle: string, replacement: string) {
    const text = this.text();
    const hit = locate(text, needle);
    if (hit.at === -1) return { ok: false, reason: hit.reason };
    this.doc.transact(() => {
      this.content.delete(hit.at, hit.len);
      this.content.insert(hit.at, replacement);
    });
    return { ok: true };
  }

  append(markdown: string) {
    this.content.insert(this.content.length, (this.content.length ? "\n\n" : "") + markdown);
  }

  insertAfter(needle: string, markdown: string) {
    const hit = locate(this.text(), needle);
    if (hit.at === -1) return { ok: false, reason: hit.reason };
    this.content.insert(hit.at + hit.len, markdown);
    return { ok: true };
  }

  /** Publish this client's presence (e.g. `{ busy }`) under the "agent" awareness field, so the browser can tell an attached agent from a human "user" state. */
  setPresence(fields: Record<string, unknown>) {
    this.awareness.setLocalStateField("agent", fields);
  }

  close() {
    this.awareness.destroy();
    this.ws.close();
  }
}
