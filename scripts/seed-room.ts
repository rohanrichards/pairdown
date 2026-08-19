#!/usr/bin/env bun
// Replace a room's document with fresh content. Used to start a new room while
// multi-room does not exist yet — the thing this room is about.
//
//   bun run scripts/seed-room.ts data/doc.bin path/to/seed.md
import * as Y from "yjs";
import { readFileSync, writeFileSync } from "node:fs";

const [target, seedPath] = process.argv.slice(2);
if (!target || !seedPath) {
  console.error("usage: seed-room.ts <doc.bin> <seed.md>");
  process.exit(1);
}

const doc = new Y.Doc();
// normalise line endings: a CRLF document defeats multi-line agent edits
const seed = readFileSync(seedPath, "utf8").replace(/\r\n/g, "\n");
doc.getText("content").insert(0, seed);
doc.getArray("comments"); // create it empty so the client finds the right type
writeFileSync(target, Y.encodeStateAsUpdate(doc));
console.log(`seeded ${target} with ${seed.length} chars, 0 comments`);
