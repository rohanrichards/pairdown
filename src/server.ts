// Standalone web-only mode: run the multi-room server without Claude Code
// attached. Useful for testing the collaborative half on its own.
import { Rooms } from "./rooms";
import { startWeb } from "./web";
import { join } from "node:path";

const dir = process.env.SPEC_ROOM_DATA ?? join(import.meta.dir, "..", "data", "rooms");
const rooms = new Rooms(dir);
const secret = process.env.SPEC_ROOM_SECRET;
const web = startWeb(rooms, Number(process.env.SPEC_ROOM_PORT ?? 8790), 10, secret);
if (!web) {
  console.error("spec-room: no free port");
  process.exit(1);
}
console.log(`spec-room: ${rooms.list().length} rooms on http://127.0.0.1:${web.port}`);
console.log(secret ? "spec-room: gate: on" : "spec-room: gate: off (no SPEC_ROOM_SECRET)");
