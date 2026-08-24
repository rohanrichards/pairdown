// Standalone web-only mode: run the multi-room server without Claude Code
// attached. Useful for testing the collaborative half on its own.
import { Rooms } from "./rooms";
import { startWeb } from "./web";
import { join } from "node:path";

const dir = process.env.PAIRDOWN_DATA ?? join(import.meta.dir, "..", "data", "rooms");
const rooms = new Rooms(dir);
const secret = process.env.PAIRDOWN_SECRET;
const web = startWeb(rooms, Number(process.env.PAIRDOWN_PORT ?? 8790), 10, secret);
if (!web) {
  console.error("pairdown: no free port");
  process.exit(1);
}
console.log(`pairdown: ${rooms.list().length} rooms on http://127.0.0.1:${web.port}`);
console.log(secret ? "pairdown: gate: on" : "pairdown: gate: off (no PAIRDOWN_SECRET)");
