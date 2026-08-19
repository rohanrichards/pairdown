// Standalone web-only mode: run the document and editor without Claude Code
// attached. Useful for testing the collaborative half on its own.
import { startWeb, setAgentPresent } from "./web";

const PORT = Number(process.env.SPEC_ROOM_PORT ?? 8790);
startWeb(PORT);
setAgentPresent(false);
console.log(`spec-room (no agent) on http://127.0.0.1:${PORT}`);
