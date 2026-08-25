#!/usr/bin/env bun
// @bun

// src/config.ts
function setting(name, optionKey) {
  return process.env[`PAIRDOWN_${name}`] || process.env[`PAIRDOWN_PLUGIN_${name}`] || process.env[`CLAUDE_PLUGIN_OPTION_${optionKey}`] || undefined;
}
var agentHandle = () => (setting("AGENT", "AGENT_HANDLE") ?? "claude").toLowerCase();
var agentOwner = () => setting("OWNER", "OWNER");
var roomUrl = () => setting("URL", "SERVER_URL") ?? "ws://127.0.0.1:8790";
var sharedKey = () => setting("SECRET", "SHARED_KEY");

// scripts/session-start.ts
var handle = agentHandle();
var owner = agentOwner();
var base = roomUrl();
var http = base.replace(/^ws/, "http");
async function rooms() {
  try {
    const res = await fetch(`${http}/api/rooms`, {
      signal: AbortSignal.timeout(1500),
      headers: sharedKey() ? { authorization: `Bearer ${sharedKey()}` } : {}
    });
    if (!res.ok)
      return null;
    return await res.json();
  } catch {
    return null;
  }
}
var lines = [];
var found = await rooms();
if (found === null) {
  lines.push(`Pairdown: no room server at ${base}.`, `If the room is on someone else's machine, their server URL and shared key go in the plugin's settings \u2014 run /plugin configure pairdown.`, `If it should be on this machine, run \`pairdown\` in a terminal to start one.`, `Everything else in this session works regardless; Pairdown's tools will simply fail until a server is reachable.`);
} else {
  const who = owner ? `@${handle}, ${owner}'s agent` : `@${handle}`;
  lines.push(`Pairdown: room server at ${base} with ${found.length} room${found.length === 1 ? "" : "s"}. You would join as ${who}.`);
  if (found.length) {
    lines.push(`Rooms: ${found.slice(0, 8).map((r) => `${r.name} (${r.id})`).join(", ")}${found.length > 8 ? ", \u2026" : ""}`);
  }
  lines.push(`Call room_list to see them, then room_join to attach. You stay dormant in a room until somebody writes @${handle} in a comment.`);
}
if (handle === "claude") {
  lines.push(`Warning: this agent has no handle of its own, so it answers to @claude \u2014 the same as every other unconfigured agent.`, `If more than one of you is in a room, you will be indistinguishable and a single @claude will wake all of you.`, `Tell the user to run /plugin configure pairdown and set an agent handle and their name.`);
} else if (!owner) {
  lines.push(`Note: no owner is set, so people see @${handle} with no indication of whose agent it is. /plugin configure pairdown sets it.`);
}
console.log(lines.join(`
`));
