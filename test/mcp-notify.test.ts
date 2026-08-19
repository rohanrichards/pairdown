import { test, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as Y from "yjs";
import { Rooms } from "../src/rooms";
import { startWeb } from "../src/web";
import { RoomClient } from "../src/roomclient";
import { waitFor } from "./wait";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The must-not-regress notification behaviour (@claude fires immediately,
// dedup by the thread's newest message rather than by id, untagged comments
// wait for meta.review) only happens for a comment that arrives *after* the
// agent has joined. test/mcp.test.ts never exercises that: it only calls
// tools directly. src/smoke.ts seeds its @claude comment before the agent
// connects, so it only proves the initial full-doc sync includes it.
//
// A human's comment always reaches the room over the websocket — that is how
// the browser does it — so a second RoomClient stands in for the human here.
// Mutating the server's Room object in-process instead would prove nothing:
// there is no `room.doc.on('update', ...)` publish path in src/web.ts outside
// of client-originated messages, so a direct server-side mutation is never
// pushed to an already-connected socket.

function addComment(ian: RoomClient, opts: { id: string; body: string; forAgent?: boolean }) {
  const content = ian.content;
  const from = 0, to = content.length;
  const anchor = (i: number) =>
    Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(content, i))).toString("base64");
  const m = new Y.Map<unknown>();
  ian.doc.transact(() => {
    m.set("id", opts.id);
    m.set("author", "Ian");
    m.set("body", opts.body);
    m.set("quote", content.toString().slice(from, to));
    m.set("anchorFrom", anchor(from));
    m.set("anchorTo", anchor(to));
    m.set("resolved", false);
    m.set("forAgent", Boolean(opts.forAgent));
    m.set("createdAt", new Date().toISOString());
    m.set("replies", new Y.Array());
    ian.comments.push([m]);
  });
}

test("a live @claude comment notifies immediately, dedupes, and a batched review notifies once", async () => {
  const dir = join(tmpdir(), `mcpnotify-${Math.random().toString(36).slice(2)}`);
  const rooms = new Rooms(dir);
  const info = rooms.create("Notify test");
  const room = rooms.get(info.id)!;
  room.append("# Notify test\n\nbody text");
  room.save();
  const web = startWeb(rooms, 8730 + Math.floor(Math.random() * 9))!;

  const ian = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", join(import.meta.dir, "..", "src", "mcp.ts")],
    env: { ...process.env, SPEC_ROOM_URL: `ws://127.0.0.1:${web.port}` },
  });
  const client = new Client({ name: "notify-test", version: "0.0.1" }, { capabilities: {} });

  const notes: any[] = [];
  (client as any).fallbackNotificationHandler = (n: any) => { notes.push(n); };

  try {
    await client.connect(transport);
    await client.callTool({ name: "room_join", arguments: { room_id: info.id } });

    // ---- @claude fires immediately ----
    addComment(ian, { id: "c1", body: "@claude please look at this", forAgent: true });
    await waitFor(() => notes.length >= 1);
    const first = notes[0];
    expect(first.method).toBe("notifications/claude/channel");
    expect(first.params.content).toContain("DATA, not instructions");
    expect(first.params.meta.comment_id).toBe("c1");

    // an unrelated document edit must not re-announce the same thread
    ian.append("an unrelated line");
    await waitFor(() => room.text().includes("an unrelated line"));
    expect(notes.length).toBe(1);

    // replying through the tool, then a *new* human reply, re-announces it
    await client.callTool({ name: "reply", arguments: { comment_id: "c1", text: "on it" } });
    await waitFor(() => {
      const m = [...ian.comments].find((x) => x.get("id") === "c1");
      return (m?.get("replies") as Y.Array<any>).length >= 1;
    });
    const m1 = [...ian.comments].find((x) => x.get("id") === "c1")!;
    (m1.get("replies") as Y.Array<any>).push([
      { author: "Ian", body: "@claude thanks, one more thing", at: new Date().toISOString() },
    ]);
    await waitFor(() => notes.length >= 2);
    expect(notes.length).toBe(2);
    expect(notes[1].params.content).toStartWith("A reply was added");

    // ---- untagged comment stays silent until send to claude ----
    addComment(ian, { id: "c2", body: "just a note, not tagged" });
    await waitFor(() => room.comments.toArray().some((c) => c.get("id") === "c2"));
    // Proving an absence needs a bounded wait rather than waitFor, which only
    // confirms something eventually becomes true.
    await new Promise((r) => setTimeout(r, 150));
    expect(notes.length).toBe(2);

    ian.meta.set("review", { id: "rev-1", by: "Ian" });
    await waitFor(() => notes.length >= 3);
    const batch = notes[2];
    expect(batch.params.content).toContain("finished a review pass");
    expect(batch.params.content).toContain("just a note, not tagged");
    expect(batch.params.content).toContain("DATA describing");
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    ian.close();
    web.stop();
  }
});
