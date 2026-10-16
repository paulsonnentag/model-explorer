// Compares two versions of a Vensim model by what they define rather than by their text, and says what
// each hunk of a text diff of the .mdl file amounts to. Runs in Node and in the browser.
//
// Most of a Vensim diff is not the model: the sketch section (the diagrams) and the settings after it
// are rewritten on every save, and constants are re-printed in exponent form with fewer digits.

import type { Definition, ParsedMdl } from "./mdl.ts";
import type { FilePatch, Hunk } from "./patch.ts";

export type DefinitionKind = "added" | "removed" | "equation" | "constant" | "rounding" | "documentation";

export type DefinitionChange = { key: string; name: string; kind: DefinitionKind; before: Definition | null; after: Definition | null };

// What a hunk touches, most significant first: changed equations and constants, changed comments, the
// authors' changelog, rounding, the diagrams, and editor state.
export type HunkKind = DefinitionKind | "changelog" | "diagram" | "whitespace" | "editor";

export const HUNK_KINDS: Record<HunkKind, { label: string; noise: boolean }> = {
  added: { label: "New definition", noise: false },
  removed: { label: "Removed definition", noise: false },
  equation: { label: "Equation changed", noise: false },
  constant: { label: "Constant changed", noise: false },
  documentation: { label: "Comment changed", noise: false },
  changelog: { label: "Changelog", noise: false },
  rounding: { label: "Rounding on save", noise: true },
  diagram: { label: "Diagram", noise: true },
  whitespace: { label: "Whitespace in the diagrams", noise: true },
  editor: { label: "Vensim editor state", noise: true },
};

const ORDER: HunkKind[] = ["added", "removed", "equation", "constant", "documentation", "changelog", "rounding", "diagram", "whitespace", "editor"];
const SKETCH_MARKER = "\\\\\\---///";
const SETTINGS_MARKER = "///---\\\\\\";
const ROUNDING = 1e-5;
// The authors keep a changelog as text boxes on one of the diagrams: "220214 - Corrected …".
const CHANGELOG = /^\d{6} - /;

export function diffDefinitions(base: ParsedMdl, head: ParsedMdl): DefinitionChange[] {
  const before = byIdentity(base.definitions);
  const after = byIdentity(head.definitions);
  const changes: DefinitionChange[] = [];
  for (const [id, a] of after) {
    const b = before.get(id);
    const kind = b ? kindOf(b, a) : "added";
    if (kind) changes.push({ key: a.key, name: a.name, kind, before: b ?? null, after: a });
  }
  for (const [id, b] of before) if (!after.has(id)) changes.push({ key: b.key, name: b.name, kind: "removed", before: b, after: null });
  return changes;
}

// Each hunk's most significant kind, and the definitions it touches.
export function classifyHunks(file: FilePatch, baseText: string, headText: string, changes: DefinitionChange[]): { hunk: Hunk; kind: HunkKind; keys: string[] }[] {
  const base = regions(baseText);
  const head = regions(headText);
  const kindOfKey = new Map(changes.map((c) => [c.key, c.kind]));
  return file.hunks.map((hunk) => {
    const kinds = new Set<HunkKind>();
    const keys = new Set<string>();
    const removed = hunk.lines.filter((l) => l.kind === "-");
    const added = hunk.lines.filter((l) => l.kind === "+");
    for (const line of [...removed, ...added]) {
      const side = line.kind === "-" ? base : head;
      const at = (line.kind === "-" ? line.oldLine : line.newLine)!;
      if (CHANGELOG.test(line.text)) kinds.add("changelog");
      else if (at >= side.settings) kinds.add("editor");
      else if (at < side.sketch) {
        const key = side.keyAt(at);
        if (key && kindOfKey.has(key)) {
          keys.add(key);
          kinds.add(kindOfKey.get(key)!);
        }
      }
    }
    const sketchLines = (lines: typeof removed, side: ReturnType<typeof regions>) =>
      lines.filter((l) => {
        const at = (l.kind === "-" ? l.oldLine : l.newLine)!;
        return at >= side.sketch && at < side.settings && !CHANGELOG.test(l.text);
      });
    const [oldSketch, newSketch] = [sketchLines(removed, base), sketchLines(added, head)];
    if (oldSketch.length || newSketch.length) {
      const squash = (lines: typeof removed) => lines.map((l) => l.text.replace(/\s+/g, "")).sort().join("\n");
      kinds.add(squash(oldSketch) === squash(newSketch) ? "whitespace" : "diagram");
    }
    return { hunk, kind: ORDER.find((k) => kinds.has(k)) ?? "whitespace", keys: [...keys] };
  });
}

function byIdentity(definitions: Definition[]): Map<string, Definition> {
  return new Map(definitions.map((d) => [`${d.key}[${d.subscripts.join(",")}]`, d]));
}

function kindOf(b: Definition, a: Definition): DefinitionKind | null {
  const [eb, ea] = [squash(b.expression), squash(a.expression)];
  if (eb !== ea || b.kind !== a.kind) {
    const [nb, na] = [Number(eb), Number(ea)];
    if (eb !== "" && ea !== "" && !Number.isNaN(nb) && !Number.isNaN(na)) return Math.abs(na - nb) <= ROUNDING * Math.max(Math.abs(nb), Math.abs(na)) ? "rounding" : "constant";
    return "equation";
  }
  if (squash(b.units) !== squash(a.units) || squash(b.comment) !== squash(a.comment)) return "documentation";
  return null;
}

function squash(text: string): string {
  return text.replace(/\s+/g, "");
}

// Where the sketch and settings sections start (1-based lines), and which definition a line is in.
function regions(text: string) {
  const lines = text.split("\n");
  const sketch = lines.findIndex((l) => l.startsWith(SKETCH_MARKER));
  const settings = lines.findIndex((l) => l.startsWith(SETTINGS_MARKER));
  const starts: { line: number; key: string }[] = [];
  let blockStart = 1;
  for (let i = 0; i < (sketch < 0 ? lines.length : sketch); i++) {
    if (!lines[i].trim() && i + 1 === blockStart) blockStart = i + 2;
    if (i + 1 === blockStart) {
      const name = lines[i].match(/^\s*("[^"]+"|[^=:\[(~|*]+?)\s*(\[|=|:|\(|$)/)?.[1];
      if (name && !lines[i].trim().startsWith("*") && !lines[i].trim().startsWith("~")) starts.push({ line: i + 1, key: name.replace(/"/g, "").toLowerCase().replace(/[_\s]+/g, " ").trim() });
    }
    if (/\|\s*\r?$/.test(lines[i])) blockStart = i + 2;
  }
  return {
    sketch: sketch < 0 ? Infinity : sketch + 1,
    settings: settings < 0 ? Infinity : settings + 1,
    keyAt(line: number): string | null {
      let key: string | null = null;
      for (const s of starts) {
        if (s.line > line) break;
        key = s.key;
      }
      return key;
    },
  };
}
