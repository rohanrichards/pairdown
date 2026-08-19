import { test, expect } from "bun:test";
import { Rooms } from "../src/rooms";
import { startWeb } from "../src/web";
import { RoomClient } from "../src/roomclient";
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
