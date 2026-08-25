#!/usr/bin/env bun
// What the agent is told about Pairdown when a session begins.
//
// The install path has two failure modes that are invisible until somebody is
// already in a room and confused: an agent left on the default handle, which
// collides with every other unconfigured agent and hides one of them from the
// room, and a room server that cannot be reached, which looks identical to
// "nobody is talking to me". Both are worth saying up front, once, cheaply.
//
// This runs on every session of anyone who has the plugin enabled, so it stays
// quiet when everything is fine, never blocks, and never fails the session.
import { agentHandle, agentOwner, roomUrl, sharedKey } from "../src/config";

const handle = agentHandle();
const owner = agentOwner();
const base = roomUrl();
const http = base.replace(/^ws/, "http");

type Room = { id: string; name: string };

/** Ask the server what rooms it has. Short timeout: a session must never wait on this. */
async function rooms(): Promise<Room[] | null> {
  try {
    const res = await fetch(`${http}/api/rooms`, {
      signal: AbortSignal.timeout(1500),
      headers: sharedKey() ? { authorization: `Bearer ${sharedKey()}` } : {},
    });
    if (!res.ok) return null;
    return (await res.json()) as Room[];
  } catch {
    return null;
  }
}

const lines: string[] = [];
const found = await rooms();

if (found === null) {
  lines.push(
    `Pairdown: no room server at ${base}.`,
    `If the room is on someone else's machine, their server URL and shared key go in the plugin's settings — run /plugin configure pairdown.`,
    `If it should be on this machine, run \`pairdown\` in a terminal to start one.`,
    `Everything else in this session works regardless; Pairdown's tools will simply fail until a server is reachable.`,
  );
} else {
  const who = owner ? `@${handle}, ${owner}'s agent` : `@${handle}`;
  lines.push(
    `Pairdown: room server at ${base} with ${found.length} room${found.length === 1 ? "" : "s"}. You would join as ${who}.`,
  );
  if (found.length) {
    lines.push(`Rooms: ${found.slice(0, 8).map((r) => `${r.name} (${r.id})`).join(", ")}${found.length > 8 ? ", …" : ""}`);
  }
  lines.push(
    `Call room_list to see them, then room_join to attach. You stay dormant in a room until somebody writes @${handle} in a comment.`,
  );
}

// The handle is what makes an agent addressable, and the default is shared by
// every unconfigured install. Say so whenever it has been left alone, because
// the symptom otherwise appears in someone else's browser, not here.
if (handle === "claude") {
  lines.push(
    `Warning: this agent has no handle of its own, so it answers to @claude — the same as every other unconfigured agent.`,
    `If more than one of you is in a room, you will be indistinguishable and a single @claude will wake all of you.`,
    `Tell the user to run /plugin configure pairdown and set an agent handle and their name.`,
  );
} else if (!owner) {
  lines.push(`Note: no owner is set, so people see @${handle} with no indication of whose agent it is. /plugin configure pairdown sets it.`);
}

console.log(lines.join("\n"));
