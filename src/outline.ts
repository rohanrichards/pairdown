export type OutlineEntry = {
  level: number; title: string; words: number; hasDiagram: boolean; offset: number;
};

const DIAGRAM = /^```(svg|html|mermaid)\s*$/;

export function outlineOf(text: string): OutlineEntry[] {
  const lines = text.split("\n");
  const out: OutlineEntry[] = [];
  let fenced = false;
  let offset = 0;
  for (const line of lines) {
    const start = offset;
    offset += line.length + 1;
    if (line.startsWith("```")) {
      if (!fenced && DIAGRAM.test(line) && out.length) out[out.length - 1].hasDiagram = true;
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const h = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (h) {
      out.push({ level: h[1].length, title: h[2], words: 0, hasDiagram: false, offset: start });
      continue;
    }
    if (out.length) out[out.length - 1].words += (line.match(/\S+/g) ?? []).length;
  }
  return out;
}
