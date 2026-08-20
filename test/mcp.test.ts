import { test, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as Y from "yjs";
import { Rooms } from "../src/rooms";
import { startWeb } from "../src/web";
import { waitFor } from "./wait";
import { tmpdir } from "node:os";
import { join } from "node:path";

const text = (r: any) => r.content.map((c: any) => c.text).join("\n");

test("the agent can list, join, read and edit a room over MCP", async () => {
  const dir = join(tmpdir(), `mcp-${Math.random().toString(36).slice(2)}`);
  const rooms = new Rooms(dir);
  const info = rooms.create("Tool test");
  rooms.get(info.id)!.append("# Tool test\n\na line to change");
  rooms.get(info.id)!.save();
  const web = startWeb(rooms, 8600 + Math.floor(Math.random() * 80))!;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", join(import.meta.dir, "..", "src", "mcp.ts")],
    env: { ...process.env, SPEC_ROOM_URL: `ws://127.0.0.1:${web.port}` },
  });
  const client = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);

  const names = (await client.listTools()).tools.map((t) => t.name);
  expect(names).toContain("room_join");
  expect(names).not.toContain("edit_spec");

  const listed = text(await client.callTool({ name: "room_list", arguments: {} }));
  expect(listed).toContain(info.id);

  await client.callTool({ name: "room_join", arguments: { room_id: info.id } });
  expect(text(await client.callTool({ name: "read", arguments: {} }))).toContain("a line to change");

  const edited = text(await client.callTool({
    name: "edit", arguments: { find: "a line to change", replace: "a line that changed" },
  }));
  expect(edited).toStartWith("Edited");

  await waitFor(() => rooms.get(info.id)!.text().includes("a line that changed"));
  expect(rooms.get(info.id)!.text()).toContain("a line that changed");

  const outline = text(await client.callTool({ name: "outline", arguments: {} }));
  expect(outline).toContain("Tool test");

  await client.close();
  await transport.close();
  web.stop();
});

test("a tool call before joining a room explains itself rather than throwing", async () => {
  const web = startWeb(new Rooms(join(tmpdir(), `mcp2-${Math.random().toString(36).slice(2)}`)),
                       8680 + Math.floor(Math.random() * 9))!;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", join(import.meta.dir, "..", "src", "mcp.ts")],
    env: { ...process.env, SPEC_ROOM_URL: `ws://127.0.0.1:${web.port}` },
  });
  const client = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  expect(text(await client.callTool({ name: "read", arguments: {} }))).toContain("room_join");
  await client.close(); await transport.close(); web.stop();
});

test("a comment's scope defaults to quote when absent, and prints on read", async () => {
  const dir = join(tmpdir(), `mcp-scope-${Math.random().toString(36).slice(2)}`);
  const rooms = new Rooms(dir);
  const info = rooms.create("Scope test");
  const room = rooms.get(info.id)!;
  room.append("# Scope test\n\na paragraph to comment on");
  room.save();
  const web = startWeb(rooms, 8760 + Math.floor(Math.random() * 9))!;

  const content = room.content;
  const anchor = (i: number) =>
    Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(content, i))).toString("base64");

  function seedComment(id: string, scope?: string) {
    const m = new Y.Map<unknown>();
    room.doc.transact(() => {
      m.set("id", id);
      m.set("author", "Ian");
      m.set("body", "a note");
      m.set("quote", "paragraph");
      m.set("anchorFrom", anchor(0));
      m.set("anchorTo", anchor(content.length));
      m.set("resolved", false);
      m.set("forAgent", false);
      m.set("createdAt", new Date().toISOString());
      m.set("replies", new Y.Array());
      if (scope) m.set("scope", scope);
      room.comments.push([m]);
    });
  }

  // No scope field at all — a document written before this feature existed.
  seedComment("legacy");
  seedComment("blocky", "block");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", join(import.meta.dir, "..", "src", "mcp.ts")],
    env: { ...process.env, SPEC_ROOM_URL: `ws://127.0.0.1:${web.port}` },
  });
  const client = new Client({ name: "scope-test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
  await client.callTool({ name: "room_join", arguments: { room_id: info.id } });

  const out = text(await client.callTool({ name: "read", arguments: {} }));
  expect(out).toContain("[legacy] Ian (quote)");
  expect(out).toContain("[blocky] Ian (block)");

  await client.close();
  await transport.close();
  web.stop();
});
