// Parses the text of a Vensim .mdl file into definitions, subscript ranges and diagram views.
// Runs both in Node and in the browser, so it must not import anything platform specific.

import { parseSketchView, type SketchGeometry } from "./sketch.ts";

// "extrapolate" is our name for data declared without a keyword: the published runs
// extrapolate those linearly past the last data point, while ":INTERPOLATE:" data holds.
export type DataMode = "interpolate" | "extrapolate" | "raw" | "hold backward" | "look forward";

export type Definition = {
  name: string;
  key: string;
  subscripts: string[];
  kind: "equation" | "data";
  dataMode: DataMode;
  expression: string;
  units: string;
  comment: string;
  group: string;
  line: number;
  supplementary: boolean;
  text: string;
};

export type Range = { name: string; key: string; members: string[]; line: number };

export type View = { name: string; variableKeys: string[] } & SketchGeometry;

export type ParsedMdl = { definitions: Definition[]; ranges: Range[]; views: View[] };

export function parseMdl(rawSource: string): ParsedMdl {
  const source = rawSource.replace(/\r\n?/g, "\n");
  const sketchStart = source.indexOf("\\\\\\---///");
  const equationPart = sketchStart < 0 ? source : source.slice(0, sketchStart);
  const sketchPart = sketchStart < 0 ? "" : source.slice(sketchStart);
  const { definitions, ranges } = parseEquationPart(equationPart);
  return { definitions: shareUnitsAndComments(definitions), ranges, views: parseViews(sketchPart) };
}

export function normalizeName(name: string): string {
  return name.replace(/"/g, "").toLowerCase().replace(/[_\s]+/g, " ").trim();
}

function parseEquationPart(text: string): { definitions: Definition[]; ranges: Range[] } {
  const definitions: Definition[] = [];
  const ranges: Range[] = [];
  let group = "";
  for (const { block, line } of splitBlocks(text)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("*")) {
      group = trimmed.match(/\n\s*\.([^\n*]+)/)?.[1].trim() ?? group;
      continue;
    }
    const parsed = parseBlock(block, line, group);
    if (parsed?.type === "definition") definitions.push(parsed.definition);
    if (parsed?.type === "range") ranges.push(parsed.range);
  }
  return { definitions, ranges };
}

function splitBlocks(text: string): { block: string; line: number }[] {
  const blocks: { block: string; line: number }[] = [];
  let line = 1;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "|") continue;
    const block = text.slice(start, i).replace("{UTF-8}", "");
    const leading = block.match(/^\s*/)![0];
    blocks.push({ block, line: line + countNewlines(leading) });
    line += countNewlines(text.slice(start, i + 1));
    start = i + 1;
  }
  return blocks;
}

function countNewlines(text: string): number {
  let count = 0;
  for (const ch of text) if (ch === "\n") count++;
  return count;
}

type ParsedBlock = { type: "definition"; definition: Definition } | { type: "range"; range: Range } | null;

function parseBlock(block: string, line: number, group: string): ParsedBlock {
  const flat = block.replace(/\\\r?\n/g, " ");
  const [lhsAndRhs, units = "", comment = "", ...flags] = flat.split("~");
  const head = lhsAndRhs.trim().match(/^("[^"]+"|[^=:\[\(]+)\s*(?:\[([^\]]*)\])?\s*([\s\S]*)$/);
  if (!head) return null;
  const name = head[1].replace(/"/g, "").trim();
  const subscripts = head[2] ? head[2].split(",").map(normalizeName) : [];
  const rest = head[3].trim();
  const base = {
    name,
    key: normalizeName(name),
    subscripts,
    units: units.replace(/\[[^\]]*\]\s*$/, "").trim(),
    comment: comment.replace(/\s+/g, " ").trim(),
    group,
    line,
    supplementary: flags.join("~").includes(":SUPPLEMENTARY"),
    text: block.replace(/^\s*\n/, "").trimEnd() + "\n\t|",
  };

  const dataKeyword = rest.match(/^:(INTERPOLATE|RAW|HOLD BACKWARD|LOOK FORWARD):\s*(?::?=([\s\S]*))?$/i);
  if (dataKeyword) {
    const mode = dataKeyword[1].toLowerCase() as DataMode;
    return definition({ ...base, kind: "data", dataMode: mode, expression: (dataKeyword[2] ?? "").trim() });
  }
  if (rest.startsWith(":=")) return definition({ ...base, kind: "data", dataMode: "interpolate", expression: rest.slice(2).trim() });
  if (rest.startsWith("=")) return definition({ ...base, kind: "equation", dataMode: "interpolate", expression: rest.slice(1).trim() });
  if (rest === "") return definition({ ...base, kind: "data", dataMode: "extrapolate", expression: "" });
  if (rest.startsWith(":")) {
    const members = rest
      .slice(1)
      .split("->")[0]
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    return { type: "range", range: { name, key: base.key, members, line } };
  }
  return null;
}

function definition(d: Definition): ParsedBlock {
  return { type: "definition", definition: d };
}

// Vensim writes units and comment only on the last of several definitions of the same variable.
function shareUnitsAndComments(definitions: Definition[]): Definition[] {
  const byKey = new Map<string, { units: string; comment: string }>();
  for (const d of definitions) {
    const known = byKey.get(d.key);
    if (!known || (!known.units && d.units) || (!known.comment && d.comment)) {
      byKey.set(d.key, { units: d.units || known?.units || "", comment: d.comment || known?.comment || "" });
    }
  }
  return definitions.map((d) => ({ ...d, units: d.units || byKey.get(d.key)!.units, comment: d.comment || byKey.get(d.key)!.comment }));
}

function parseViews(sketch: string): View[] {
  const chunks = sketch.split(/\n\*(?=[^\n]+\n\$)/).slice(1);
  return chunks.map((chunk) => {
    const lines = chunk.split("\n");
    const keys = lines.filter((line) => line.startsWith("10,")).map((line) => normalizeName(sketchName(line)));
    return { name: lines[0].trim(), variableKeys: [...new Set(keys)], ...parseSketchView(lines.slice(2), normalizeName) };
  });
}

function sketchName(line: string): string {
  const rest = line.replace(/^10,\d+,/, "");
  if (rest.startsWith('"')) return rest.slice(1, rest.indexOf('"', 1));
  return rest.slice(0, rest.indexOf(","));
}
