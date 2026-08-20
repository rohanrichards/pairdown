import { fenceOpener, closesFence } from "./fences";

export type OutlineEntry = {
  level: number; title: string; words: number; hasDiagram: boolean; offset: number;
};

const DIAGRAM = /^(`{3,}|~{3,})(svg|html|mermaid)\s*$/;

export function outlineOf(text: string): OutlineEntry[] {
  const lines = text.split("\n");
  const out: OutlineEntry[] = [];
  let fenceDelim: string | null = null;  // null if not fenced, otherwise the opening delimiter
  let offset = 0;
  for (const line of lines) {
    const start = offset;
    offset += line.length + 1;

    // Check for fence line (backticks or tildes)
    const opener = fenceOpener(line);
    if (opener) {
      if (fenceDelim === null) {
        // Opening a fence
        fenceDelim = opener;
        // Check if this is a diagram fence
        if (DIAGRAM.test(line) && out.length) {
          out[out.length - 1].hasDiagram = true;
        }
      } else if (closesFence(line, fenceDelim)) {
        // Closing the fence - same character, at least as many
        fenceDelim = null;
      }
      // Either way (opened, closed, or content), skip further processing of this line
      continue;
    }

    if (fenceDelim !== null) continue;  // Inside a fence, skip processing

    const h = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (h) {
      out.push({ level: h[1].length, title: h[2], words: 0, hasDiagram: false, offset: start });
      continue;
    }
    // Content before the first heading is intentionally dropped (no preamble slot in OutlineEntry)
    if (out.length) out[out.length - 1].words += (line.match(/\S+/g) ?? []).length;
  }
  return out;
}
