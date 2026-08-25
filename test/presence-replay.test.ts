// Presence has to survive somebody arriving late.
//
// The server relays awareness frames and keeps none of them, so for a long time
// a client learned who was in the room only by being there when they announced
// themselves. An agent attaches, says so once, and anybody who joins or reloads
// afterwards sees an empty room — while the agent is still connected and still
// answering. That is the failure these tests exist to stop coming back.
import { test, expect, afterEach } from "bun:test";
import { Rooms } from "../src/rooms";
import { startWeb } from "../src/web";
import { RoomClient } from "../src/roomclient";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = () => join(tmpdir(), `replay-${Math.random().toString(36).slice(2)}`);
const port = () => 8700 + Math.floor(Math.random() * 200);

const shutdown: Array<() => void> = [];
afterEach(() => { while (shutdown.length) shutdown.pop()!(); });

function serve() {
  const rooms = new Rooms(dir());
  const info = rooms.create("Replay room");
  const web = startWeb(rooms, port(), 20)!;
  shutdown.push(() => web.stop());
  return { info, base: `ws://127.0.0.1:${web.port}` };
}

/** Poll until `check` passes or time runs out, so a pass never depends on one lucky sleep. */
async function until<T>(check: () => T | undefined, ms = 3000): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = check();
    if (v !== undefined) return v;
    if (Date.now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Every agent state visible to this client, other than its own. */
function agentsSeenBy(c: RoomClient) {
  const out: any[] = [];
  c.awareness.getStates().forEach((state: any, id: number) => {
    if (id === c.awareness.clientID) return;
    if (state.agent) out.push(state.agent);
  });
  return out;
}

test("a client that joins after an agent announced itself still sees it", async () => {
  const { info, base } = serve();

  const agent = await RoomClient.connect(base, info.id);
  shutdown.push(() => agent.close());
  agent.setPresence({ handle: "maple", label: "maple — Ian's agent", owner: "Ian", busy: false });

  // Everything the agent will ever say about itself has now been said. Only
  // then does the second client arrive — which is the whole point.
  await new Promise((r) => setTimeout(r, 150));

  const latecomer = await RoomClient.connect(base, info.id);
  shutdown.push(() => latecomer.close());

  const seen = await until(() => {
    const a = agentsSeenBy(latecomer);
    return a.length ? a : undefined;
  });

  expect(seen).toBeDefined();
  expect(seen![0].handle).toBe("maple");
  expect(seen![0].owner).toBe("Ian");
});

test("a late joiner sees every agent in the room, not just the last one", async () => {
  const { info, base } = serve();

  const maple = await RoomClient.connect(base, info.id);
  shutdown.push(() => maple.close());
  maple.setPresence({ handle: "maple", owner: "Ian", busy: false });

  const ren = await RoomClient.connect(base, info.id);
  shutdown.push(() => ren.close());
  ren.setPresence({ handle: "ren", owner: "Rohan", busy: false });

  await new Promise((r) => setTimeout(r, 150));

  const latecomer = await RoomClient.connect(base, info.id);
  shutdown.push(() => latecomer.close());

  const seen = await until(() => {
    const a = agentsSeenBy(latecomer);
    return a.length >= 2 ? a : undefined;
  });

  expect(seen?.map((a) => a.handle).sort()).toEqual(["maple", "ren"]);
});

test("a late joiner sees the agent's current state, not the one it announced with", async () => {
  const { info, base } = serve();

  const agent = await RoomClient.connect(base, info.id);
  shutdown.push(() => agent.close());
  agent.setPresence({ handle: "maple", owner: "Ian", busy: false });
  await new Promise((r) => setTimeout(r, 80));
  agent.setPresence({ handle: "maple", owner: "Ian", busy: true, comment_id: "c7" });
  await new Promise((r) => setTimeout(r, 80));

  const latecomer = await RoomClient.connect(base, info.id);
  shutdown.push(() => latecomer.close());

  const seen = await until(() => {
    const a = agentsSeenBy(latecomer);
    return a.length ? a[0] : undefined;
  });

  expect(seen?.busy).toBe(true);
  expect(seen?.comment_id).toBe("c7");
});

test("an agent that has gone is not replayed to someone who arrives afterwards", async () => {
  // Replaying whatever was last heard would be worse than saying nothing: a
  // crashed agent would sit in the room forever, looking ready to answer.
  const { info, base } = serve();

  const agent = await RoomClient.connect(base, info.id);
  agent.setPresence({ handle: "maple", owner: "Ian", busy: false });
  await new Promise((r) => setTimeout(r, 120));
  agent.close();
  await new Promise((r) => setTimeout(r, 200));

  const latecomer = await RoomClient.connect(base, info.id);
  shutdown.push(() => latecomer.close());
  await new Promise((r) => setTimeout(r, 400));

  expect(agentsSeenBy(latecomer)).toEqual([]);
});

test("presence is republished, so a peer never reaps an agent that is still attached", async () => {
  // y-protocols drops a peer whose state has not been refreshed inside its
  // outdated timeout, and it is the owner of a state that must refresh it. The
  // browser does that for its own cursor; RoomClient did not, so a connected
  // agent aged out of everyone else's room while still answering.
  //
  // Waiting out the real 30s timeout would make this suite unusable, so the
  // renewal interval is turned right down and the assertion is that the
  // watcher's clock for that peer keeps moving — which is the thing that
  // stops the reap.
  const { info, base } = serve();

  const agent = await RoomClient.connect(base, info.id, { renewMs: 120 });
  shutdown.push(() => agent.close());
  agent.setPresence({ handle: "maple", owner: "Ian", busy: false });

  const watcher = await RoomClient.connect(base, info.id);
  shutdown.push(() => watcher.close());

  const id = await until(() => {
    for (const [clientId, state] of watcher.awareness.getStates() as Map<number, any>) {
      if (clientId !== watcher.awareness.clientID && state.agent) return clientId;
    }
    return undefined;
  });
  expect(id).toBeDefined();

  const clockAt = () => (watcher.awareness.meta.get(id!) as any)?.lastUpdated ?? 0;
  const before = clockAt();
  const moved = await until(() => (clockAt() > before ? true : undefined), 2000);

  expect(moved).toBe(true);
  expect(agentsSeenBy(watcher).map((a) => a.handle)).toEqual(["maple"]);
}, 10000);
