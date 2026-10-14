// The shared state of the explorer, and helpers for reading a variable's values out of a run.

import type { Bundle } from "../core/inputs.ts";
import type { CompiledModel, RunResult } from "../core/compile.ts";
import type { Points } from "../shared/chart.ts";
import type { Runs, WhatIf } from "../shared/runs.ts";
import type { Semantics } from "../shared/semantics.ts";
import * as totals from "../shared/totals.ts";

export type App = {
  bundle: Bundle;
  model: CompiledModel;
  sem: Semantics;
  runs: Runs;
  whatIf: WhatIf;
  focus: string;
  trail: string[];
  openRoots: string | null;
  expandedColumns: Set<string>;
  graphMode: "dependencies" | "diagram";
  diagramView: string | null;
  year: number;
  current: RunResult;
  reference: RunResult | null;
  published: { name: string; series: Map<string, (number | null)[]> } | null;
  actions: Actions;
};

export type Actions = {
  focus: (key: string) => void;
  edit: (cell: number, value: number | null) => void;
  clearEdits: () => void;
  setWhatIf: (patch: Partial<App["whatIf"]>) => void;
  toggleRoots: (role: string) => void;
  expandColumn: (id: string) => void;
  setGraphMode: (mode: App["graphMode"], view?: string) => void;
  setYear: (year: number) => void;
};

export const ELEMENT_COLORS = ["#2f6db5", "#c7473a", "#2e8a57", "#c47f12", "#7a57b8", "#1d8a99", "#b0457f", "#6b6b6b"];
export const DATA_COLOR = "#1f7a47";
export const REFERENCE_COLOR = "#9aa0a6";
export const PUBLISHED_COLOR = "#111";

export function visibleCells(app: App, key: string, limit: number): number[] {
  return (app.sem.vars.get(key)?.cells ?? []).filter((c) => !app.model.cells[c].hidden).slice(0, limit);
}

export function isConstant(app: App, key: string): boolean {
  const cells = app.sem.vars.get(key)?.cells ?? [];
  return cells.length > 0 && cells.every((c) => app.model.cells[c].kind === "const");
}

export function constantValue(app: App, cell: number): number {
  return app.current.values[cell];
}

// Observed data shown alongside a variable: its own data points if it is a data series,
// otherwise the data series the calibration compares it with.
export function dataPointsFor(app: App, key: string): Points[] {
  const info = app.sem.vars.get(key);
  if (!info) return [];
  const own = info.cells.map((c) => app.model.dataPoints(c)).filter((p) => p !== null);
  if (own.length) return own.slice(0, 4).map((p) => ({ times: p!.times, values: p!.values, color: DATA_COLOR, label: "data" }));
  return info.measuredAs.flatMap((m) => {
    const dataCell = app.sem.vars.get(m.data)?.cells[0];
    const points = dataCell === undefined ? null : app.model.dataPoints(dataCell);
    return points ? [{ times: points.times, values: points.values, color: DATA_COLOR, label: app.sem.vars.get(m.data)!.name }] : [];
  });
}

export { escapeHtml, sourceLink } from "../shared/html.ts";

// A variable's total across its visible elements (e.g. the three treatment types) at one year.
export function totalAt(app: App, key: string, year: number): number {
  return totals.totalAt(app.model, app.sem, app.current, key, year);
}

export function totalSeries(app: App, key: string): Float64Array {
  return totals.totalSeries(app.model, app.sem, app.current, key);
}
