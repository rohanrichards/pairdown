#!/usr/bin/env bun
// Dump a room's markdown (and optionally its comment threads) out of a doc.bin.
// The inverse of seed-room.ts, and the thing that makes archiving a room cheap.
//
//   bun run scripts/export-room.ts data/doc.bin docs/whatever.md [--threads]
import * as Y from "yjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [source, target, ...flags] = process.argv.slice(2);
if (!source || !target) {
  console.error("usage: export-room.ts <doc.bin> <out.md> [--threads]");
  process.exit(1);
}

const doc = new Y.Doc();
Y.applyUpdate(doc, readFileSync(source));
const text = doc.getText("content").toString();
const comments = doc.getArray<Y.Map<unknown>>("comments");

let out = text;
if (flags.includes("--threads") && comments.length) {
  const lines = ["", "---", "", "## Comment threads at export", ""];
  for (const m of comments) {
    const replies = (m.get("replies") as Y.Array<any>) ?? [];
    lines.push(
      `- **${m.get("author")}** on "${String(m.get("quote") ?? "").slice(0, 60)}"` +
        `${m.get("resolved") ? " _(resolved)_" : ""}`,
      `  ${m.get("body")}`,
    );
    for (const r of replies) lines.push(`  - **${r.author}**: ${r.body}`);
  }
  out += lines.join("\n") + "\n";
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out.replace(/\r\n/g, "\n"), "utf8");
console.log(`exported ${text.length} chars, ${comments.length} threads -> ${target}`);
