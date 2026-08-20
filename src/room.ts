import * as Y from "yjs";
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
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
    // A state file that will not apply — a torn write, a truncated copy — must
    // not throw from whichever route happened to open the room first: that
    // surfaces as an opaque 500 on /r/<id>, or as a socket that never receives
    // its initial state, on a room the index still lists as fine. Move the bad
    // bytes aside so they are kept for inspection rather than re-read on every
    // subsequent open, and let the room open empty and editable.
    if (existsSync(file)) {
      try {
        Y.applyUpdate(room.doc, readFileSync(file));
      } catch (e) {
        const aside = `${file}.corrupt`;
        try {
          renameSync(file, aside);
          process.stderr.write(
            `spec-room: ${file} is not a readable room state (${e}); moved to ${aside}. ` +
              `Room ${id} opens empty.\n`,
          );
        } catch (moveErr) {
          process.stderr.write(
            `spec-room: ${file} is not a readable room state (${e}) and could not be ` +
              `moved aside (${moveErr}). Room ${id} opens empty.\n`,
          );
        }
      }
    }
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
    const text = this.text();
    const hit = locate(text, needle);
    if (hit.at === -1) return { ok: false, reason: hit.reason };
    const body = text.includes("\r\n") ? markdown.replace(/\r?\n/g, "\r\n") : markdown;
    this.content.insert(hit.at + hit.len, body);
    return { ok: true };
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.save(); }, 400);
  }

  /**
   * Persist the whole document state.
   *
   * Written to a sibling temp file and renamed onto the target, never straight
   * over it. writeFileSync truncates before it writes, so an in-place save left
   * the room's only on-disk copy empty or short for the length of the write —
   * and the debounce above makes that a frequent window, not a rare one. rename
   * is atomic within a filesystem, so a reader sees either the whole previous
   * state or the whole new one.
   */
  save() {
    const tmp = `${this.file}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(tmp, Y.encodeStateAsUpdate(this.doc));
      renameSync(tmp, this.file);
    } catch (e) {
      process.stderr.write(`spec-room: save failed for ${this.file}: ${e}\n`);
    }
  }
}
