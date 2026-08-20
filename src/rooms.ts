import { Room } from "./room";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type RoomInfo = { id: string; name: string; createdAt: string; session?: string };

// Generate exactly 8 characters from [a-z0-9]
// Guarantees length by repeatedly calling toString(36) until we have enough characters
export const newId = (): string => {
  let id = "";
  while (id.length < 8) {
    id += Math.random().toString(36).slice(2);
  }
  return id.slice(0, 8);
};

export class Rooms {
  private index: RoomInfo[] = [];
  private open = new Map<string, Room>();

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
    if (existsSync(this.indexFile)) this.index = JSON.parse(readFileSync(this.indexFile, "utf8"));
  }

  private get indexFile() { return join(this.dir, "index.json"); }
  private fileFor(id: string) { return join(this.dir, `${id}.bin`); }
  private flush() { writeFileSync(this.indexFile, JSON.stringify(this.index, null, 2)); }

  create(name: string, session?: string): RoomInfo {
    const info: RoomInfo = { id: newId(), name, createdAt: new Date().toISOString(), session };
    this.index.push(info);
    this.flush();
    const room = Room.load(info.id, this.fileFor(info.id), name);
    // Every client displays the name out of meta, not the JSON index, so it
    // has to be seeded here — before the initial save persists the doc.
    room.meta.set("name", name);
    this.open.set(info.id, room);
    room.save();
    return info;
  }

  list(): RoomInfo[] { return [...this.index]; }

  get(id: string): Room | null {
    if (this.open.has(id)) return this.open.get(id)!;
    const info = this.index.find((r) => r.id === id);
    if (!info) return null;
    const room = Room.load(info.id, this.fileFor(info.id), info.name);
    this.open.set(id, room);
    return room;
  }

  rename(id: string, name: string): boolean {
    const info = this.index.find((r) => r.id === id);
    if (!info) return false;
    info.name = name;
    // this.get(), not this.open.get(): a closed room still has meta on disk,
    // and it must not go on disagreeing with the index once renamed.
    const room = this.get(id);
    if (room) {
      room.name = name;
      // Live so every connected browser repaints, not just the next join.
      room.meta.set("name", name);
    }
    this.flush();
    return true;
  }
}
