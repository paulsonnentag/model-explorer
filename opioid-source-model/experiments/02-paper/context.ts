// The paper view's shared state, and helpers that turn manifest entries into numbers from live runs.

import type { Bundle } from "../core/inputs.ts";
import type { CompiledModel, RunResult } from "../core/compile.ts";
import type { Points } from "../shared/chart.ts";
import type { Runs, WhatIf } from "../shared/runs.ts";
import type { Semantics } from "../shared/semantics.ts";
import type { Claim, ClaimContext, ClaimResult, Item, RunKey, Series, TableRow } from "./items.ts";

export type Selection = { item: Item; sub?: string };
export type Status = "reproduced" | "close" | "differs";

export type PaperApp = {
  bundle: Bundle;
  model: CompiledModel;
  sem: Semantics;
  runs: Runs;
  cellIndex: Map<string, number>;
  selection: Selection | null;
  edits: Map<number, number>;
  editGroups: Map<string, { label: string; cells: Map<number, number> }>;
  published: Map<string, Float64Array | null>;
  actions: Actions;
};

export type Actions = {
  select: (selection: Selection | null) => void;
  setEdit: (id: string, label: string | null, cells: Map<number, number>) => void;
  clearEdits: () => void;
  loadPublished: (runs: RunKey[], cells: string[]) => void;
};

export const RUN_LABELS: Record<RunKey, string> = {
  Base: "Exogenous trends continue (Base.cin)",
  Pos: "Optimistic (Pos.cin)",
  Neg: "Pessimistic (Neg.cin)",
  NoFent: "History without illicit fentanyl (NoFentHist.cin)",
};

export const REPRODUCED_WITHIN = 0.01;
export const CLOSE_WITHIN = 0.1;

export function whatIf(run: RunKey, edits: Map<number, number>): WhatIf {
  return { future: run === "NoFent" ? "Base" : run, noFentanyl: run === "NoFent", lever: "None", strength: "20", edits };
}

export function runOf(app: PaperApp, run: RunKey, edits = app.edits): RunResult {
  return app.runs.current(whatIf(run, edits));
}

export function publishedName(app: PaperApp, run: RunKey): string | null {
  return app.runs.publishedName(whatIf(run, new Map()));
}

export function explorerQuery(run: RunKey): string {
  return run === "NoFent" ? "nofent=1" : run === "Base" ? "" : `future=${run}`;
}

// A series over the run's full time axis: the sum of its terms, scaled, and optionally relative to one year.
export function seriesValues(app: PaperApp, series: Series, divisor: number, edits = app.edits): Float64Array {
  const run = runOf(app, series.run, edits);
  return sumTerms(app, series, divisor, run.times, (cell, step) => run.values[step * run.cellCount + cell]);
}

export function publishedValues(app: PaperApp, series: Series, divisor: number): Float64Array | null {
  const name = publishedName(app, series.run);
  if (!name) return null;
  const rows = series.terms.map((t) => app.published.get(`${name}|${t}`));
  if (rows.some((r) => !r)) return null;
  const times = runOf(app, series.run).times;
  const index = new Map(series.terms.map((t, i) => [app.cellIndex.get(t)!, i]));
  return sumTerms(app, series, divisor, times, (cell, step) => rows[index.get(cell)!]![step]);
}

// Observed data are drawn once a year, like the authors' figures, and only up to the end of the data.
export function dataPoints(app: PaperApp, values: Float64Array, from: number, to: number): Points {
  const times = runOf(app, "Base").times;
  const out: Points = { times: [], values: [], color: "#9a9a9a" };
  for (let year = from; year <= Math.min(to, 2020); year++) {
    const step = stepOf(times, year);
    const v = values[step];
    if (Number.isFinite(v) && Math.abs(v) < 1e30) {
      out.times.push(year);
      out.values.push(v);
    }
  }
  return out;
}

export function stepOf(times: ArrayLike<number>, year: number): number {
  return Math.round((year - times[0]) / (times[1] - times[0]));
}

export function claimContext(app: PaperApp, edits = app.edits): ClaimContext {
  return {
    at: (run, key, year) => {
      const r = runOf(app, run, edits);
      const cell = app.cellIndex.get(key) ?? app.model.variables.get(key)?.cells[0];
      return cell === undefined ? NaN : r.values[stepOf(r.times, year) * r.cellCount + cell];
    },
    dataPoints: (key) => {
      const cell = app.model.variables.get(key)?.cells[0];
      return cell === undefined ? null : app.model.dataPoints(cell);
    },
    roleCount: (role) => [...app.sem.vars.values()].filter((v) => v.role === role).length,
  };
}

export function evaluateClaim(app: PaperApp, claim: Claim, edits = app.edits): { result: ClaimResult; status: Status; error: number } {
  const result = claim.compute(claimContext(app, edits));
  const error = worstError(claim.paperValues, result.values);
  return { result, status: statusFor(error), error };
}

export type RowValues = { ours: number[]; paper: number[]; status: Status; error: number };

export function evaluateRow(app: PaperApp, row: TableRow, edits = app.edits): RowValues {
  const ctx = claimContext(app, edits);
  const key = `projection output data[${row.element}]`;
  const ours = [ctx.at("Base", key, 2020), ctx.at("Base", key, 2032), ctx.at("Pos", key, 2032), ctx.at("Neg", key, 2032)].map((v) => v * row.scale);
  const paper = row.paper.map((s) => Number(s.replace(/[^0-9.]/g, "")));
  const error = worstError(paper, ours.map((v) => Number(v.toPrecision(3))));
  return { ours, paper, status: statusFor(error), error };
}

export function statusFor(error: number): Status {
  return error <= REPRODUCED_WITHIN ? "reproduced" : error <= CLOSE_WITHIN ? "close" : "differs";
}

export const STATUS_TEXT: Record<Status, { mark: string; label: string }> = {
  reproduced: { mark: "✓", label: "Reproduced" },
  close: { mark: "≈", label: "Close" },
  differs: { mark: "✗", label: "Differs" },
};

function worstError(paper: number[], ours: number[]): number {
  return Math.max(...paper.map((p, i) => Math.abs(ours[i] - p) / Math.max(Math.abs(p), 1e-12)));
}

function sumTerms(
  app: PaperApp,
  series: Series,
  divisor: number,
  times: ArrayLike<number>,
  read: (cell: number, step: number) => number | null,
): Float64Array {
  const cells = series.terms.map((t) => app.cellIndex.get(t) ?? app.model.variables.get(t)?.cells[0] ?? -1);
  const out = new Float64Array(times.length);
  for (let step = 0; step < times.length; step++) {
    let total = 0;
    for (const cell of cells) {
      const v = cell < 0 ? NaN : read(cell, step);
      if (v === null || !Number.isFinite(v) || Math.abs(v) > 1e30) {
        total = NaN;
        break;
      }
      total += v;
    }
    out[step] = (series.from !== undefined && times[step] < series.from) ? NaN : total / divisor;
  }
  if (series.normalizeAt !== undefined) {
    const base = out[stepOf(times, series.normalizeAt)];
    for (let i = 0; i < out.length; i++) out[i] /= base;
  }
  return out;
}
