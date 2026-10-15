// Everything a review shows about one change: both versions of the model compiled and run, what the
// text diff amounts to, which constants each run ends up with, and where in the model that acts.

import { type CompiledModel, type Override, type RunResult, compileModel } from "../core/compile.ts";
import { type ParsedMdl, parseMdl } from "../core/mdl.ts";
import { type DefinitionChange, type HunkKind, classifyHunks, diffDefinitions } from "../core/model-diff.ts";
import type { ModelFolder } from "../core/model-folder.ts";
import { type FilePatch, type Hunk, applyPatch, parsePatch } from "../core/patch.ts";
import { peopleFlows } from "../shared/flows.ts";
import { type Loop, findLoops } from "../shared/loops.ts";
import { Runs, type WhatIf } from "../shared/runs.ts";
import { type Semantics, buildSemantics } from "../shared/semantics.ts";
import type { ChangeFile } from "./change-file.ts";

export const FITTED: WhatIf = { future: "Base", lever: "None", strength: "20", noFentanyl: false, edits: new Map() };

export type Side = {
  text: string;
  mdl: ParsedMdl;
  bundle: ModelFolder;
  model: CompiledModel;
  sem: Semantics;
  runs: Runs;
  loops: Loop[];
  // What every run of this side sees: model.mdl, every-run/, the future, then the change's files.
  constants: Float64Array;
  setBy: string[];
};

// A constant the fitted run sees differently, cell by cell; `before` is null for a new constant.
export type Setting = { cell: string; key: string; before: number | null; after: number; file: string };

export type ReviewHunk = { hunk: Hunk; kind: HunkKind; keys: string[] };

export type FileDiff = { patch: FilePatch; added: number; removed: number; hunks: ReviewHunk[] };

export type PublishedRow = { key: string; side: string; time: number; value: number };

export type Review = {
  change: ChangeFile;
  base: Side;
  head: Side;
  files: FileDiff[];
  definitions: DefinitionChange[];
  settings: Setting[];
  // Per changed variable, the flows it feeds and the loops it is a strength of.
  actsOn: Map<string, { flows: string[]; loops: string[] }>;
  published: PublishedRow[];
};

// `files` holds the text of every file in changes/ by path; `read` fetches files from opioid-model/.
export async function buildReview(folder: ModelFolder, modelText: string, change: ChangeFile, files: Map<string, string>, read: (path: string) => Promise<string>): Promise<Review> {
  const patches = change.patch ? parsePatch(files.get(change.patch) ?? "") : [];
  const modelPatch = patches.find((p) => p.path === "model.mdl");
  const merged = change.status === "merged";
  const baseText = modelPatch && merged ? applyPatch(modelText, modelPatch, true) : modelText;
  const headText = modelPatch && !merged ? applyPatch(modelText, modelPatch) : modelText;
  const added = await Promise.all(
    change.adds.map(async (path) => {
      const inPatch = patches.find((p) => p.path === path);
      return { path, text: inPatch ? applyPatch("", inPatch) : await read(path), patch: inPatch ?? newFile(path, await read(path)) };
    }),
  );
  const base = side(folder, baseText, []);
  const head = side(folder, headText, added.map((a) => ({ file: a.path, overrides: cinOverrides(a.text) })));
  const definitions = diffDefinitions(base.mdl, head.mdl);
  const shown = [...patches, ...added.filter((a) => !patches.includes(a.patch)).map((a) => a.patch)];
  const settings = settingsChanged(base, head);
  return {
    change,
    base,
    head,
    files: shown.map((patch) => fileDiff(patch, baseText, headText, definitions)),
    definitions,
    settings,
    actsOn: new Map([...new Set([...definitions.map((d) => d.key), ...settings.map((s) => s.key)])].map((key) => [key, actsOn(head, key)])),
    published: change.published ? publishedRows(files.get(change.published) ?? "") : [],
  };
}

// The base run of the same what-if, laid out like the head model so it can be drawn as the comparison;
// cells the base model does not have are NaN.
export function alignedBaseRun(review: Review, run: RunResult): RunResult {
  const { base, head } = review;
  if (base.model.cells.length === head.model.cells.length && base.model.cells.every((c, i) => c.key === head.model.cells[i].key)) return run;
  const index = new Map(base.model.cells.map((c, i) => [c.key, i]));
  const map = head.model.cells.map((c) => index.get(c.key) ?? -1);
  const n = map.length;
  const steps = run.times.length;
  const values = new Float64Array(steps * n);
  for (let s = 0; s < steps; s++) for (let i = 0; i < n; i++) values[s * n + i] = map[i] < 0 ? NaN : run.values[s * run.cellCount + map[i]];
  return { times: run.times, cellCount: n, values, series: (cell) => Float64Array.from({ length: steps }, (_, s) => values[s * n + cell]) };
}

export function isNoise(kind: HunkKind): boolean {
  return kind === "rounding" || kind === "diagram" || kind === "whitespace" || kind === "editor";
}

function side(folder: ModelFolder, text: string, appended: { file: string; overrides: Override[] }[]): Side {
  const mdl = parseMdl(text);
  const bundle: ModelFolder = { ...folder, mdl };
  const model = compileModel({ definitions: mdl.definitions, ranges: mdl.ranges, data: folder.data });
  const sem = buildSemantics(bundle, model);
  const runs = new Runs(bundle, model, appended.flatMap((a) => a.overrides));
  const layers = [
    ...folder.baseChanges,
    { file: folder.files.fittedValues, overrides: folder.fitted.map(({ target, value }) => ({ target, value })) },
    ...folder.scenarios.filter((s) => s.name === FITTED.future).map((s) => ({ file: s.file, overrides: s.overrides })),
    ...appended,
  ];
  const constants = model.defaults();
  const setBy = model.cells.map(() => "model.mdl");
  for (const layer of layers) {
    model.applyOverrides(constants, layer.overrides);
    for (const o of layer.overrides) for (const cell of model.resolveOverride(o.target)) setBy[cell] = layer.file;
  }
  return { text, mdl, bundle, model, sem, runs, loops: findLoops(sem), constants, setBy };
}

function settingsChanged(base: Side, head: Side): Setting[] {
  const index = new Map(base.model.cells.map((c, i) => [c.key, i]));
  return head.model.cells.flatMap((cell, i) => {
    if (cell.kind !== "const") return [];
    const j = index.get(cell.key);
    const before = j === undefined ? null : base.constants[j];
    const after = head.constants[i];
    if (before !== null && Math.abs(after - before) <= 1e-12 * Math.max(1, Math.abs(before))) return [];
    return [{ cell: cell.key, key: cell.variable, before, after, file: head.setBy[i] }];
  });
}

// The flows a variable feeds, through anything but stocks, and the loops it is a strength of.
function actsOn(side: Side, key: string): { flows: string[]; loops: string[] } {
  const flows = new Set(peopleFlows(side.sem).map((f) => f.key));
  const found = new Set<string>();
  const seen = new Set([key]);
  const queue = [key];
  while (queue.length) {
    const next = queue.shift()!;
    if (flows.has(next)) {
      found.add(next);
      continue;
    }
    const info = side.sem.vars.get(next);
    if (!info || (next !== key && info.role === "stock")) continue;
    for (const user of info.usedBy) {
      if (seen.has(user)) continue;
      seen.add(user);
      queue.push(user);
    }
  }
  return { flows: [...found], loops: side.loops.filter((l) => l.links.some((link) => link.strength === key)).map((l) => l.id) };
}

function fileDiff(patch: FilePatch, baseText: string, headText: string, definitions: DefinitionChange[]): FileDiff {
  const lines = patch.hunks.flatMap((h) => h.lines);
  const hunks: ReviewHunk[] =
    patch.path === "model.mdl"
      ? classifyHunks(patch, baseText, headText, definitions)
      : patch.hunks.map((hunk) => ({ hunk, kind: "constant", keys: hunk.lines.filter((l) => l.kind === "+").map((l) => cinKey(l.text)) }));
  return { patch, added: lines.filter((l) => l.kind === "+").length, removed: lines.filter((l) => l.kind === "-").length, hunks };
}

function newFile(path: string, text: string): FilePatch {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return {
    path,
    isNew: true,
    hunks: [{ oldStart: 0, newStart: 1, header: "", lines: lines.map((line, i) => ({ kind: "+", text: line, oldLine: null, newLine: i + 1 })) }],
  };
}

function cinOverrides(text: string): Override[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith(":"))
    .map((line) => ({ target: line.split("=")[0].trim(), value: Number(line.split("=")[1]) }))
    .filter((o) => !Number.isNaN(o.value));
}

function cinKey(line: string): string {
  return line.split("=")[0].replace(/\[.*$/, "").trim().toLowerCase().replace(/[_\s]+/g, " ");
}

function publishedRows(text: string): PublishedRow[] {
  return text
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("variable\t"))
    .map((l) => {
      const [name, side, time, value] = l.split("\t");
      return { key: name.toLowerCase(), side, time: Number(time), value: Number(value) };
    });
}
