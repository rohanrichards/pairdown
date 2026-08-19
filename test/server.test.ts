import { test, expect } from "bun:test";
import * as Y from "yjs";
import { Rooms } from "../src/rooms";
import { startWeb } from "../src/web";
import { tag, untag } from "../src/frames";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("two clients in the same room see each other's edits", async () => {
  const rooms = new Rooms(join(tmpdir(), `srv-${Math.random().toString(36).slice(2)}`));
  const info = rooms.create("Sync test");
  const web = startWeb(rooms, 8900 + Math.floor(Math.random() * 80))!;

  const connect = () =>
    new Promise<WebSocket>((res) => {
      const ws = new WebSocket(`ws://127.0.0.1:${web.port}/ws?room=${info.id}`);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => res(ws);
    });

  const a = await connect();
  const b = await connect();
  const docB = new Y.Doc();
  b.onmessage = (e) => {
    const { kind, payload } = untag(new Uint8Array(e.data as ArrayBuffer));
    if (kind === 0) Y.applyUpdate(docB, payload);
  };

  const docA = new Y.Doc();
  docA.getText("content").insert(0, "written by A");
  a.send(tag(0, Y.encodeStateAsUpdate(docA)));

  await new Promise((r) => setTimeout(r, 250));
  expect(docB.getText("content").toString()).toContain("written by A");
  a.close(); b.close(); web.stop();
});

test("an unknown room id is refused rather than silently created", async () => {
  const rooms = new Rooms(join(tmpdir(), `srv-${Math.random().toString(36).slice(2)}`));
  const web = startWeb(rooms, 8990 + Math.floor(Math.random() * 9))!;
  const res = await fetch(`http://127.0.0.1:${web.port}/r/nosuchid`);
  expect(res.status).toBe(404);
  web.stop();
});
