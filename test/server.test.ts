import { test, expect } from "bun:test";
import * as Y from "yjs";
import { Rooms } from "../src/rooms";
import { startWeb } from "../src/web";
import { tag, untag } from "../src/frames";
import { waitFor } from "./wait";
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

  await waitFor(() => docB.getText("content").toString().includes("written by A"));
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

test("posting a name to /api/rooms creates a room and returns its info", async () => {
  const rooms = new Rooms(join(tmpdir(), `srv-${Math.random().toString(36).slice(2)}`));
  const web = startWeb(rooms, 8970 + Math.floor(Math.random() * 9))!;
  const res = await fetch(`http://127.0.0.1:${web.port}/api/rooms`, {
    method: "POST",
    body: JSON.stringify({ name: "New room" }),
  });
  const info = await res.json();
  expect(info.name).toBe("New room");
  expect(rooms.get(info.id)).not.toBeNull();
  web.stop();
});

test("GET / serves the room index, not the editor", async () => {
  const rooms = new Rooms(join(tmpdir(), `srv-${Math.random().toString(36).slice(2)}`));
  const web = startWeb(rooms, 8830 + Math.floor(Math.random() * 9))!;
  const res = await fetch(`http://127.0.0.1:${web.port}/`);
  const body = await res.text();
  expect(body).toContain('id="create-form"');
  expect(body).not.toContain('src="/js/editor.js"');
  // No rooms were created in this registry, so the empty-state branch runs.
  expect(body).toContain('id="empty"');
  expect(body).toContain("No rooms yet");
  web.stop();
});

test("GET / lists a room created through the registry", async () => {
  const rooms = new Rooms(join(tmpdir(), `srv-${Math.random().toString(36).slice(2)}`));
  const info = rooms.create("Weekly Sync");
  const web = startWeb(rooms, 8840 + Math.floor(Math.random() * 9))!;
  const res = await fetch(`http://127.0.0.1:${web.port}/`);
  const body = await res.text();
  expect(body).toContain("Weekly Sync");
  expect(body).toContain(`/r/${info.id}`);
  web.stop();
});

test("a room name containing HTML is escaped on the index page", async () => {
  const rooms = new Rooms(join(tmpdir(), `srv-${Math.random().toString(36).slice(2)}`));
  rooms.create("<script>alert(1)</script>");
  rooms.create("Tom & Jerry <b>");
  const web = startWeb(rooms, 8850 + Math.floor(Math.random() * 9))!;
  const res = await fetch(`http://127.0.0.1:${web.port}/`);
  const body = await res.text();
  expect(body).not.toContain("<script>alert(1)</script>");
  expect(body).not.toContain("Tom & Jerry <b>");
  expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(body).toContain("Tom &amp; Jerry &lt;b&gt;");
  web.stop();
});

test("a server that cannot bind any port returns null rather than throwing", () => {
  const rooms = new Rooms(join(tmpdir(), `srv-${Math.random().toString(36).slice(2)}`));
  expect(() => {
    const web = startWeb(rooms, 8990 + Math.floor(Math.random() * 9), 0);
    expect(web).toBeNull();
  }).not.toThrow();
});
