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
