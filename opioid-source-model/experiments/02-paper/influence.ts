// Ranks the assumptions an item rests on by how much they move it: each upstream constant is nudged
// by 10% and the item's runs are repeated. This runs in small batches so the page stays responsive.

import type { Role } from "../shared/semantics.ts";
import type { PaperApp } from "./context.ts";
import { evaluateClaim, evaluateRow, seriesValues, stepOf, runOf } from "./context.ts";
import type { Item, RunKey, Series } from "./items.ts";

export type Influence = { key: string; name: string; role: Role; cells: number[]; base: number[]; effect: number; lower: number; upper: number };

const NUDGE = 0.1;
const ASSUMPTION_ROLES: Role[] = ["fitted", "literature", "data-derived", "assumption", "expert", "calibrated", "constant"];
const cache = new Map<string, Influence[]>();

export function cachedInfluence(item: Item): Influence[] | null {
  return cache.get(item.id) ?? null;
}

export async function rankInfluence(app: PaperApp, item: Item, onProgress: (done: number, total: number) => void): Promise<Influence[]> {
  const candidates = upstreamAssumptions(app, itemVariables(app, item));
  const measure = metric(app, item);
  const baseline = measure(new Map());
  const out: Influence[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const edits = new Map<number, number>();
    c.cells.forEach((cell, j) => edits.set(cell, c.base[j] * (1 + NUDGE)));
    c.effect = distance(baseline, measure(edits));
    out.push(c);
    if (i % 6 === 5) {
      onProgress(i + 1, candidates.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  out.sort((a, b) => b.effect - a.effect);
  cache.set(item.id, out);
  return out;
}

// Variables an item reads, as model variable keys.
export function itemVariables(app: PaperApp, item: Item): string[] {
  if (item.kind === "claim") return item.variables;
  if (item.kind === "row") return [`projection output data`];
  const keys = new Set<string>();
  for (const series of figureSeries(item)) {
    if (series.kind !== "sim") continue;
    for (const term of series.terms) {
      const cell = app.cellIndex.get(term);
      if (cell !== undefined) keys.add(app.model.cells[cell].variable);
    }
  }
  for (const part of item.parts ?? []) part.terms.forEach((t) => keys.add(t));
  return [...keys];
}

export function figureSeries(item: Item): Series[] {
  return item.kind === "figure" ? item.panels.flatMap((p) => p.charts.flatMap((c) => c.series)) : [];
}

// Every variable the given ones depend on, through any chain of equations.
export function upstream(app: PaperApp, keys: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...keys];
  while (stack.length) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    stack.push(...(app.sem.vars.get(key)?.uses ?? []));
  }
  return seen;
}

function upstreamAssumptions(app: PaperApp, keys: string[]): Influence[] {
  const base = runOf(app, "Base", new Map());
  const out: Influence[] = [];
  for (const key of upstream(app, keys)) {
    const info = app.sem.vars.get(key);
    if (!info || !ASSUMPTION_ROLES.includes(info.role)) continue;
    const cells = info.cells.filter((c) => app.model.cells[c].kind === "const");
    const values = cells.map((c) => base.values[c]);
    if (!cells.length || values.every((v) => v === 0) || isPointInTime(values)) continue;
    const fitted = info.fitted;
    out.push({
      key,
      name: info.name,
      role: info.role,
      cells,
      base: values,
      effect: 0,
      lower: fitted ? fitted.lower : values[0] * 0.5,
      upper: fitted ? fitted.upper : values[0] * 1.5,
    });
  }
  return out;
}

function metric(app: PaperApp, item: Item): (edits: Map<number, number>) => number[] {
  if (item.kind === "claim") return (edits) => evaluateClaim(app, item, edits).result.values;
  if (item.kind === "row") return (edits) => evaluateRow(app, item, edits).ours;
  const series = figureSeries(item).filter((s) => s.kind === "sim");
  const panelRange = new Map(item.panels.flatMap((p) => p.charts.flatMap((c) => c.series.map((s) => [s, [p.from, p.to, c.divisor] as const]))));
  if (!series.length) {
    const terms = (item.parts ?? []).map((p) => ({ label: p.title, run: "Base" as RunKey, terms: p.terms, kind: "sim" as const, color: "" }));
    return (edits) => terms.flatMap((s) => yearly(app, s, 1999, 2032, 1, edits));
  }
  return (edits) => series.flatMap((s) => {
    const [from, to, divisor] = panelRange.get(s)!;
    return yearly(app, s, from, to, divisor, edits);
  });
}

function yearly(app: PaperApp, series: Series, from: number, to: number, divisor: number, edits: Map<number, number>): number[] {
  const values = seriesValues(app, series, divisor, edits);
  const times = runOf(app, series.run, edits).times;
  const out: number[] = [];
  for (let year = from; year <= to; year++) out.push(values[stepOf(times, year)]);
  return out;
}

// Years such as a policy start date: scaling them by 10% means nothing.
function isPointInTime(values: number[]): boolean {
  return values.every((v) => v >= 1900 && v <= 2100);
}

// Mean relative change, ignoring gaps.
function distance(a: number[], b: number[]): number {
  let total = 0;
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    total += Math.abs(b[i] - a[i]) / Math.max(Math.abs(a[i]), 1e-9);
    count++;
  }
  return count ? total / count : 0;
}
