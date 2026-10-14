// The shared state of the stock map, and helpers for reading stocks, flows and loops out of the
// current run.

import type { CompiledModel, RunResult } from "../core/compile.ts";
import type { Bundle } from "../core/inputs.ts";
import { formatNumber } from "../shared/chart.ts";
import type { Factor } from "../shared/factors.ts";
import type { PeopleFlow } from "../shared/flows.ts";
import { type ExternalInput, FAMILIES, INACTIVE, type Loop, upstreamTerminals } from "../shared/loops.ts";
import { PLAIN_STOCKS, dejargon, plainFlowPhrase } from "../shared/plain.ts";
import type { Runs, WhatIf } from "../shared/runs.ts";
import type { Semantics } from "../shared/semantics.ts";
import { totalAt, totalSeries } from "../shared/totals.ts";
import { PLAIN_ELEMENTS, PLAIN_RANGES, PLAIN_STAGES, PLAIN_SUBSTANCES } from "./labels.ts";
import { type MapEdge, type MapLayout, STAGES, SUBSTANCES } from "./layout.ts";

// What the pointer is over: a loop or input row, or one variable in a formula. `var` lights up what a
// variable is computed from; `path` is "loopId|inputId", the arrows through which an input feeds a loop.
export type Hover = { kind: "loop" | "input" | "stock" | "edge" | "flow" | "var" | "path"; id: string } | null;

export type Toggle = "loop" | "flow" | "stock" | "compact";

export type MapApp = {
  bundle: Bundle;
  model: CompiledModel;
  sem: Semantics;
  runs: Runs;
  whatIf: WhatIf;
  current: RunResult;
  // The run the dashed lines compare against: a finding's first alternative while another is applied.
  reference: RunResult | null;
  layout: MapLayout;
  loops: Loop[];
  inputs: ExternalInput[];
  factors: Map<string, Factor[] | null>;
  fitted: Map<string, number>;
  year: number;
  maxFlow: number;
  plain: boolean;
  openLoops: Set<string>;
  openFlows: Set<string>;
  openStocks: Set<string>;
  compactStocks: Set<string>;
  hover: Hover;
  // The unfolded hypothesis, and the "hypothesisId:alternativeId" the model is running, if any.
  hypothesis: string | null;
  alternative: string | null;
  cardOffsets: Map<string, [number, number]>;
  actions: {
    setYear: (year: number) => void;
    toggle: (kind: Toggle, id: string) => void;
    hover: (hover: Hover) => void;
    selectHypothesis: (id: string | null) => void;
    cycleHypothesis: (step: number) => void;
    applyAlternative: (hypothesis: string, alternative: string) => void;
  };
};

export const HOVER_COLOR = "#e11d48";

// Which arrows and groups to paint, and in which colour: whatever is hovered first, then open loops in
// list order. Null when nothing is brought forward.
export function highlights(app: MapApp): { edges: Map<string, string>; nodes: Map<string, string> } | null {
  const edges = new Map<string, string>();
  const nodes = new Map<string, string>();
  const paintEdges = (list: MapEdge[], color: string) => list.forEach((e) => edges.has(e.id) || edges.set(e.id, color));
  const paintLoop = (loop: Loop | undefined) => {
    if (!loop) return;
    const color = FAMILIES[loop.family].color;
    paintEdges(edgesOf(app, loop.flows), color);
    for (const k of loop.people) if (!nodes.has(k)) nodes.set(k, color);
  };
  const hover = app.hover;
  if (hover?.kind === "loop") paintLoop(app.loops.find((l) => l.id === hover.id));
  if (hover?.kind === "input") paintEdges(edgesOf(app, app.inputs.find((i) => i.id === hover.id)?.flows ?? []), HOVER_COLOR);
  if (hover?.kind === "stock") for (const k of hover.id.split("|")) nodes.set(k, HOVER_COLOR);
  if (hover?.kind === "edge") paintEdges(app.layout.edges.filter((e) => e.id === hover.id), HOVER_COLOR);
  if (hover?.kind === "flow") paintEdges(edgesOf(app, hover.id.split("|")), HOVER_COLOR);
  if (hover?.kind === "var") {
    const { flows, people } = upstreamTerminals(app.sem, hover.id);
    paintEdges(edgesOf(app, flows), HOVER_COLOR);
    for (const k of people) if (!nodes.has(k)) nodes.set(k, HOVER_COLOR);
  }
  if (hover?.kind === "path") paintEdges(edgesOf(app, inputPath(app, hover.id)), HOVER_COLOR);
  for (const loop of app.loops) if (app.openLoops.has(loop.id)) paintLoop(loop);
  return edges.size || nodes.size ? { edges, nodes } : null;
}

// The flows a loop's driver is computed from that the input also reaches, from "loopId|inputId".
export function inputPath(app: MapApp, id: string): string[] {
  const [loopId, inputId] = id.split("|");
  const loop = app.loops.find((l) => l.id === loopId);
  const input = app.inputs.find((i) => i.id === inputId);
  return loop && input ? loop.driverFlows.filter((f) => input.flows.includes(f)) : [];
}

// Hovering anything marked `data-hover="kind:id"` inside `root` highlights it on the map; the innermost
// mark wins, so a variable inside a loop row overrides the row. Its `data-var` (model keys joined by
// "|") also marks every other term on the page that stands for the same variable.
export function bindHover(root: HTMLElement | SVGElement, app: MapApp) {
  let current = "";
  let marked = "";
  const mark = (vars: string) => {
    if (vars === marked) return;
    marked = vars;
    const wanted = new Set(vars.split("|").filter(Boolean));
    for (const el of document.querySelectorAll<HTMLElement>("[data-var]")) {
      el.classList.toggle("same", el.dataset.var!.split("|").some((v) => wanted.has(v)));
    }
  };
  const set = (spec: string) => {
    if (spec === current) return;
    current = spec;
    const [kind, ...rest] = spec.split(":");
    app.actions.hover(spec ? ({ kind, id: rest.join(":") } as Hover) : null);
  };
  root.addEventListener("mouseover", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-hover]");
    set(el?.dataset.hover ?? "");
    mark(el?.dataset.var ?? "");
  });
  root.addEventListener("mouseleave", () => {
    set("");
    mark("");
  });
}

// Text for elements marked `data-live`, so values follow the year without re-rendering.
export function liveText(app: MapApp, spec: string): string {
  const [kind, ...rest] = spec.split(":");
  const id = rest.join(":");
  const was = (now: number, ref: number | null, format: (v: number) => string) =>
    ref !== null && Math.abs(ref - now) > Math.max(1e-9, Math.abs(ref) * 0.005) ? `${format(now)} (was ${format(ref)})` : format(now);
  if (kind === "x") return was(valueAt(app, id), referenceValue(app, id), (v) => `×${v.toFixed(2)}`);
  if (kind === "flow") return was(valueAt(app, id), referenceValue(app, id), (v) => `${formatNumber(v)}/yr`);
  if (kind === "edge") {
    const edge = app.layout.edges.find((e) => e.id === id)!;
    return was(edgeValue(app, edge), edgeReference(app, edge), (v) => `${formatNumber(v)}/yr`);
  }
  if (kind === "part" || kind === "share") {
    const [label, ...keys] = id.split("|");
    const parts = partsOf(app, keys)!;
    const part = parts.find((p) => p.label === label)!;
    if (kind === "share") {
      const total = parts.reduce((sum, p) => sum + partValue(app, p, app.current), 0);
      return total ? `${Math.round((100 * partValue(app, part, app.current)) / total)}%` : "";
    }
    const unit = keys.every((k) => app.factors.has(k)) ? "/yr" : "";
    return was(partValue(app, part, app.current), app.reference && partValue(app, part, app.reference), (v) => `${formatNumber(v)}${unit}`);
  }
  return was(valueAt(app, id), referenceValue(app, id), formatNumber);
}

export function updateLive(root: ParentNode, app: MapApp) {
  root.querySelectorAll<HTMLElement>("[data-live]").forEach((el) => (el.textContent = liveText(app, el.dataset.live!)));
}

// The elements of arrayed variables, e.g. one stock per medication, matched by element across `keys`;
// null when any of them is a single value. The elements add up to what the box or arrow shows.
export type Part = { label: string; cells: number[] };

export const PART_FILLS = ["#b3cdeb", "#cfe0f4", "#e8f0fa", "#f3f7fc"];
export const PART_COLORS = ["#1d4f86", "#4f8fd1", "#9cc4ec", "#cfe0f4"];

export function partsOf(app: MapApp, keys: string[]): Part[] | null {
  const byLabel = new Map<string, number[]>();
  for (const key of keys) {
    const variable = app.model.variables.get(key);
    const cells = variable?.cells.filter((c) => !app.model.cells[c].hidden) ?? [];
    if (!variable || cells.length < 2) return null;
    variable.cells.forEach((cell, i) => {
      if (app.model.cells[cell].hidden) return;
      const label = variable.elementLabels[i] ?? String(i);
      byLabel.set(label, [...(byLabel.get(label) ?? []), cell]);
    });
  }
  return [...byLabel].map(([label, cells]) => ({ label, cells }));
}

export function partValue(app: MapApp, part: Part, run: RunResult): number {
  const step = Math.max(0, Math.min(run.times.length - 1, Math.round((app.year - run.times[0]) / (run.times[1] - run.times[0]))));
  return part.cells.reduce((sum, cell) => sum + run.values[step * run.cellCount + cell], 0);
}

export function partSeries(app: MapApp, part: Part): Float64Array {
  const out = new Float64Array(app.current.times.length);
  for (const cell of part.cells) app.current.series(cell).forEach((v, i) => (out[i] += v));
  return out;
}

export function partLabel(app: MapApp, label: string): string {
  return app.plain ? (PLAIN_ELEMENTS[label] ?? label) : label;
}

// What the elements are, from the subscript on the variable's left-hand side ("TxT", or "medication").
export function rangeLabel(app: MapApp, key: string): string {
  const range = app.sem.vars.get(key)?.definitions[0]?.subscripts[0] ?? "";
  return app.plain ? (PLAIN_RANGES[range.toLowerCase()] ?? range) : range;
}

export function valueAt(app: MapApp, key: string): number {
  return totalAt(app.model, app.sem, app.current, key, app.year);
}

export function seriesOf(app: MapApp, key: string): Float64Array {
  return totalSeries(app.model, app.sem, app.current, key);
}

export function referenceValue(app: MapApp, key: string): number | null {
  return app.reference ? totalAt(app.model, app.sem, app.reference, key, app.year) : null;
}

export function referenceSeries(app: MapApp, key: string): Float64Array | null {
  return app.reference ? totalSeries(app.model, app.sem, app.reference, key) : null;
}

export function edgeValue(app: MapApp, edge: MapEdge): number {
  return edge.flows.reduce((sum, f) => sum + valueAt(app, f.key), 0);
}

export function edgeReference(app: MapApp, edge: MapEdge): number | null {
  if (!app.reference) return null;
  return edge.flows.reduce((sum, f) => sum + referenceValue(app, f.key)!, 0);
}

export function edgeSeries(app: MapApp, edge: MapEdge): Float64Array {
  const out = new Float64Array(app.current.times.length);
  for (const flow of edge.flows) seriesOf(app, flow.key).forEach((v, i) => (out[i] += v));
  return out;
}

export function edgesOf(app: MapApp, flowKeys: string[]): MapEdge[] {
  const keys = new Set(flowKeys);
  return app.layout.edges.filter((e) => e.flows.some((f) => keys.has(f.key)));
}

export function isActive(app: MapApp, strength: string): boolean {
  return Math.abs(app.fitted.get(strength) ?? 0) > INACTIVE;
}

export function loopActive(app: MapApp, loop: Loop): boolean {
  return loop.links.some((l) => isActive(app, l.strength));
}

export function nameOf(app: MapApp, key: string | null): string {
  if (!key) return "";
  if (!app.plain) return modelName(app, key);
  return PLAIN_STOCKS[key]?.name ?? dejargon(modelName(app, key));
}

export function modelName(app: MapApp, key: string): string {
  return app.sem.vars.get(key)?.modelName ?? key;
}

export function flowLabel(app: MapApp, flow: PeopleFlow): string {
  return (app.plain ? plainFlowPhrase(flow.key) : null) ?? modelName(app, flow.key);
}

export function stageLabel(app: MapApp, stage: number): string {
  return (app.plain ? PLAIN_STAGES : STAGES)[stage];
}

export function substanceLabel(app: MapApp, substance: number): string {
  return (app.plain ? PLAIN_SUBSTANCES : SUBSTANCES)[substance];
}

// The Explorer link for a variable, carrying the same scenario so its charts match this map.
export function explorerQuery(whatIf: WhatIf): string {
  const params = new URLSearchParams();
  if (whatIf.future !== "Base") params.set("future", whatIf.future);
  if (whatIf.lever !== "None") params.set("lever", whatIf.lever);
  if (whatIf.noFentanyl) params.set("nofent", "1");
  return params.toString();
}
