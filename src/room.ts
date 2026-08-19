import * as Y from "yjs";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function locate(text: string, needle: string): { at: number; len: number; reason?: string } {
  const lf = needle.replace(/\r\n/g, "\n");
  const crlf = lf.replace(/\n/g, "\r\n");
  const variants = [needle, ...[lf, crlf].filter((v) => v !== needle)];
  for (const v of variants) {
    if (!v) continue;
    const at = text.indexOf(v);
    if (at === -1) continue;
    if (text.indexOf(v, at + 1) !== -1) return { at: -1, len: 0, reason: "text is not unique" };
    return { at, len: v.length };
  }
  return { at: -1, len: 0, reason: "text not found" };
}

export class Room {
  readonly doc = new Y.Doc();
  readonly content = this.doc.getText("content");
  readonly comments = this.doc.getArray<Y.Map<unknown>>("comments");
  readonly meta = this.doc.getMap<any>("meta");
  private timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(readonly id: string, readonly file: string, public name: string) {}

  static load(id: string, file: string, name: string): Room {
    const room = new Room(id, file, name);
    if (existsSync(file)) Y.applyUpdate(room.doc, readFileSync(file));
    room.doc.on("update", () => room.schedule());
    return room;
  }

  text() { return this.content.toString(); }

  edit(needle: string, replacement: string) {
    const text = this.text();
    const hit = locate(text, needle);
    if (hit.at === -1) return { ok: false, reason: hit.reason };
    const body = text.includes("\r\n") ? replacement.replace(/\r?\n/g, "\r\n") : replacement;
    this.doc.transact(() => {
      this.content.delete(hit.at, hit.len);
      this.content.insert(hit.at, body);
    });
    return { ok: true };
  }

  append(markdown: string) {
    this.content.insert(this.content.length, (this.content.length ? "\n\n" : "") + markdown);
  }

  insertAfter(needle: string, markdown: string) {
    const hit = locate(this.text(), needle);
    if (hit.at === -1) return { ok: false, reason: hit.reason };
    this.content.insert(hit.at + hit.len, markdown);
    return { ok: true };
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.save(); }, 400);
  }

  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, Y.encodeStateAsUpdate(this.doc));
    } catch (e) {
      process.stderr.write(`spec-room: save failed for ${this.file}: ${e}\n`);
    }
  }
}
