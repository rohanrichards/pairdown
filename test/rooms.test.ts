import { test, expect } from "bun:test";
import { Rooms, newId } from "../src/rooms";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = () => join(tmpdir(), `rooms-${Math.random().toString(36).slice(2)}`);

test("a created room appears in the list and can be fetched", () => {
  const rooms = new Rooms(dir());
  const info = rooms.create("Multi room", "sess-1");
  expect(info.id).toMatch(/^[a-z0-9]{8}$/);
  expect(rooms.list().map((r) => r.id)).toContain(info.id);
  expect(rooms.get(info.id)).not.toBeNull();
});

test("renaming keeps the id, so a shared link never breaks", () => {
  const rooms = new Rooms(dir());
  const info = rooms.create("Old name");
  expect(rooms.rename(info.id, "New name")).toBe(true);
  expect(rooms.list()[0]).toMatchObject({ id: info.id, name: "New name" });
});

test("create() seeds the room's Yjs meta with its name, so every client agrees on it", () => {
  const rooms = new Rooms(dir());
  const info = rooms.create("Meta name test");
  const room = rooms.get(info.id)!;
  expect(room.meta.get("name")).toBe("Meta name test");
});

test("rename() updates the meta name on an already-open room, so it reaches every connected client live", () => {
  const rooms = new Rooms(dir());
  const info = rooms.create("Old name");
  const room = rooms.get(info.id)!; // open it before renaming
  expect(rooms.rename(info.id, "New name")).toBe(true);
  expect(room.meta.get("name")).toBe("New name");
});

test("rename() updates the meta name on a room that was never opened, so it doesn't persist a stale name to disk", () => {
  const d = dir();
  const first = new Rooms(d);
  const info = first.create("Old name");

  // A fresh registry over the same directory, standing in for a server
  // restart: the room exists on disk but has not been opened by this
  // instance, so it is absent from its in-memory `open` map.
  const second = new Rooms(d);
  expect(second.rename(info.id, "New name")).toBe(true);

  const reopened = second.get(info.id)!;
  expect(reopened.meta.get("name")).toBe("New name");
});

test("an unknown room id returns null rather than creating one", () => {
  const rooms = new Rooms(dir());
  expect(rooms.get("nosuchid")).toBeNull();
});

test("rooms survive a restart of the registry", () => {
  const d = dir();
  const first = new Rooms(d);
  const info = first.create("Persisted");
  first.get(info.id)!.append("# Hello");
  first.get(info.id)!.save();
  const second = new Rooms(d);
  expect(second.get(info.id)!.text()).toContain("# Hello");
});

test("newId generates exactly 8 characters from [a-z0-9]", () => {
  for (let i = 0; i < 500; i++) {
    const id = newId();
    expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(id.length).toBe(8);
  }
});
