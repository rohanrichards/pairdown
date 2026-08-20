import { test, expect } from "bun:test";
import { Rooms } from "../src/rooms";
import { startWeb } from "../src/web";
import { RoomClient, NOT_CONNECTED } from "../src/roomclient";
import { waitFor } from "./wait";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("an agent edit reaches the server's copy of the room", async () => {
  const rooms = new Rooms(join(tmpdir(), `rc-${Math.random().toString(36).slice(2)}`));
  const info = rooms.create("Agent test");
  rooms.get(info.id)!.append("# Title\n\noriginal line");
  const web = startWeb(rooms, 8700 + Math.floor(Math.random() * 80))!;

  const client = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);
  expect(client.text()).toContain("original line");

  client.edit("original line", "edited by the agent");
  await waitFor(() => rooms.get(info.id)!.text().includes("edited by the agent"));
  expect(rooms.get(info.id)!.text()).toContain("edited by the agent");

  client.close();
  web.stop();
});

test("insertAfter places text below the anchor, not over it", async () => {
  const rooms = new Rooms(join(tmpdir(), `rc-${Math.random().toString(36).slice(2)}`));
  const info = rooms.create("Insert test");
  rooms.get(info.id)!.append("## One\nbody");
  const web = startWeb(rooms, 8720 + Math.floor(Math.random() * 80))!;

  const client = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);
  expect(client.insertAfter("## One", "\n\nadded").ok).toBe(true);
  await waitFor(() => rooms.get(info.id)!.text().includes("added"));
  expect(rooms.get(info.id)!.text()).toBe("## One\n\nadded\nbody");

  client.close();
  web.stop();
});

test("insertAfter normalises inserted markdown to the document's CRLF, like edit does", async () => {
  const rooms = new Rooms(join(tmpdir(), `rc-${Math.random().toString(36).slice(2)}`));
  const info = rooms.create("Insert CRLF test");
  rooms.get(info.id)!.content.insert(0, "## One\r\nbody\r\n");
  const web = startWeb(rooms, 8740 + Math.floor(Math.random() * 15))!;

  const client = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);
  expect(client.insertAfter("## One", "\n\nadded\nmore").ok).toBe(true);
  await waitFor(() => rooms.get(info.id)!.text().includes("added"));
  expect(rooms.get(info.id)!.text()).toBe("## One\r\n\r\nadded\r\nmore\r\nbody\r\n");

  client.close();
  web.stop();
});

test("a room client publishes its presence as awareness, seen by another client in the same room", async () => {
  const rooms = new Rooms(join(tmpdir(), `rc-${Math.random().toString(36).slice(2)}`));
  const info = rooms.create("Presence test");
  const web = startWeb(rooms, 8760 + Math.floor(Math.random() * 80))!;

  const agent = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);
  const watcher = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);

  const hasAgentState = (busy: boolean) =>
    [...watcher.awareness.getStates().values()].some((v: any) => v.agent?.busy === busy);

  agent.setPresence({ busy: false });
  await waitFor(() => hasAgentState(false));

  agent.setPresence({ busy: true });
  await waitFor(() => hasAgentState(true));

  agent.close();
  watcher.close();
  web.stop();
});

test("edit normalises the replacement to the document's CRLF, like Room.edit does", async () => {
  const rooms = new Rooms(join(tmpdir(), `rc-${Math.random().toString(36).slice(2)}`));
  const info = rooms.create("Edit CRLF test");
  rooms.get(info.id)!.content.insert(0, "## One\r\nbody\r\n");
  const web = startWeb(rooms, 8400 + Math.floor(Math.random() * 40))!;

  const client = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);
  expect(client.edit("## One\nbody", "## One\nreplaced").ok).toBe(true);
  await waitFor(() => rooms.get(info.id)!.text().includes("replaced"));
  // A stray LF here is the bug that made a whole room uneditable: the next
  // multi-line edit against a mixed document fails as "text not found".
  expect(rooms.get(info.id)!.text()).toBe("## One\r\nreplaced\r\n");

  client.close();
  web.stop();
});

test("connecting to a nonexistent room rejects rather than resolving", async () => {
  const rooms = new Rooms(join(tmpdir(), `rc-${Math.random().toString(36).slice(2)}`));
  const web = startWeb(rooms, 8440 + Math.floor(Math.random() * 40))!;

  await expect(RoomClient.connect(`ws://127.0.0.1:${web.port}`, "nosuchid")).rejects.toThrow(
    /cannot reach the room server/,
  );

  web.stop();
});

test("a write refuses once the connection is gone, rather than mutating a doc nobody sees", async () => {
  const rooms = new Rooms(join(tmpdir(), `rc-${Math.random().toString(36).slice(2)}`));
  const info = rooms.create("Liveness test");
  rooms.get(info.id)!.append("# Title\n\noriginal line");
  const web = startWeb(rooms, 8480 + Math.floor(Math.random() * 40))!;

  const client = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);
  expect(client.connected).toBe(true);
  client.close();
  expect(client.connected).toBe(false);

  // Every write path, not just edit: a send on a closed socket is silently
  // discarded, so any of these would report success while changing nothing
  // anybody else can see.
  expect(client.edit("original line", "should not land")).toEqual({
    ok: false,
    reason: NOT_CONNECTED,
  });
  expect(client.append("should not land")).toEqual({ ok: false, reason: NOT_CONNECTED });
  expect(client.insertAfter("# Title", "should not land")).toEqual({
    ok: false,
    reason: NOT_CONNECTED,
  });
  expect(client.text()).toContain("original line");
  expect(client.text()).not.toContain("should not land");

  web.stop();
});

test("a dropped server connection is reported rather than silently absorbed", async () => {
  const rooms = new Rooms(join(tmpdir(), `rc-${Math.random().toString(36).slice(2)}`));
  const info = rooms.create("Drop test");
  rooms.get(info.id)!.append("# Title\n\noriginal line");
  const web = startWeb(rooms, 8520 + Math.floor(Math.random() * 40))!;

  const client = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);
  expect(client.connected).toBe(true);

  // A room-server restart is the ordinary case in this workflow, and it used to
  // turn the agent into a private fork that kept reporting edits as landed.
  web.stop();
  await waitFor(() => !client.connected);
  expect(client.edit("original line", "should not land").ok).toBe(false);

  client.close();
});

test("two agents editing different passages do not clobber each other", async () => {
  const rooms = new Rooms(join(tmpdir(), `rc-${Math.random().toString(36).slice(2)}`));
  const info = rooms.create("Clobber test");
  rooms.get(info.id)!.append("## A\n\nalpha line\n\n## B\n\nbeta line");
  const web = startWeb(rooms, 8560 + Math.floor(Math.random() * 40))!;

  const one = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);
  const two = await RoomClient.connect(`ws://127.0.0.1:${web.port}`, info.id);
  await waitFor(() => one.text().includes("beta line") && two.text().includes("beta line"));

  // Both resolve their target against their own copy and edit before either has
  // seen the other's change — the concurrency the edit-only tool surface exists
  // to survive. Neither may lose.
  expect(one.edit("alpha line", "alpha rewritten").ok).toBe(true);
  expect(two.edit("beta line", "beta rewritten").ok).toBe(true);

  const converged = (t: string) =>
    t.includes("alpha rewritten") &&
    t.includes("beta rewritten") &&
    !t.includes("alpha line") &&
    !t.includes("beta line");
  await waitFor(() => converged(rooms.get(info.id)!.text()));
  await waitFor(() => converged(one.text()) && converged(two.text()));

  const server = rooms.get(info.id)!.text();
  expect(one.text()).toBe(server);
  expect(two.text()).toBe(server);
  expect(server).toBe("## A\n\nalpha rewritten\n\n## B\n\nbeta rewritten");

  one.close();
  two.close();
  web.stop();
});
