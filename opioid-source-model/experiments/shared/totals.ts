// One number per variable: the sum over its cells (e.g. the three treatment types of "HUD by MOUD"),
// leaving out hidden helper cells.

import type { CompiledModel, RunResult } from "../core/compile.ts";
import type { Semantics } from "./semantics.ts";

export function totalAt(model: CompiledModel, sem: Semantics, run: RunResult, key: string, year: number): number {
  const step = Math.max(0, Math.min(run.times.length - 1, Math.round((year - run.times[0]) / (run.times[1] - run.times[0]))));
  return sumCells(model, sem, key, (cell) => run.values[step * run.cellCount + cell]);
}

export function totalSeries(model: CompiledModel, sem: Semantics, run: RunResult, key: string): Float64Array {
  const out = new Float64Array(run.times.length);
  for (let step = 0; step < run.times.length; step++) out[step] = sumCells(model, sem, key, (cell) => run.values[step * run.cellCount + cell]);
  return out;
}

export function peak(values: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]) && Math.abs(values[i]) < 1e30) max = Math.max(max, Math.abs(values[i]));
  return max;
}

function sumCells(model: CompiledModel, sem: Semantics, key: string, read: (cell: number) => number): number {
  let total = 0;
  for (const cell of sem.vars.get(key)?.cells ?? []) if (!model.cells[cell].hidden) total += read(cell);
  return total;
}
