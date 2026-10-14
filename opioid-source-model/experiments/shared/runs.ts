// Turns the what-if choices in the header into model runs, and computes the headline answers.

import type { Bundle } from "../core/inputs.ts";
import type { CompiledModel, Override, RunResult } from "../core/compile.ts";
import { parseCellName } from "../core/compile.ts";
import { scenarioOverrides } from "../core/scenario.ts";

export type WhatIf = {
  future: string;
  noFentanyl: boolean;
  lever: string;
  strength: "10" | "20" | "50";
  edits: Map<number, number>;
};

export const FUTURES: { name: string; label: string }[] = [
  { name: "Base", label: "Trends continue (Base)" },
  { name: "Pos", label: "Optimistic" },
  { name: "Neg", label: "Pessimistic" },
  { name: "Cnst", label: "Inputs frozen at latest data" },
  { name: "FentH", label: "More fentanyl" },
  { name: "FentL", label: "Less fentanyl" },
];

export const LEVERS: { name: string; label: string }[] = [
  { name: "None", label: "No policy change" },
  { name: "NxKits", label: "More naloxone kits" },
  { name: "BupProv", label: "More buprenorphine prescribers" },
  { name: "BupProvBarriers", label: "Fewer barriers to buprenorphine" },
  { name: "PeerRecovery", label: "Peer recovery support" },
  { name: "ReturntoOUD", label: "Fewer relapses" },
  { name: "DevOUD", label: "Slower development of addiction" },
  { name: "FentODRisk", label: "Lower fentanyl overdose risk" },
  { name: "RxRate", label: "Fewer patients prescribed opioids" },
  { name: "DivRxInit", label: "Less misuse of diverted pills" },
  { name: "OwnRxInit", label: "Less misuse of own prescription" },
  { name: "HInit", label: "Fewer people starting heroin" },
  { name: "NxPeerRecovery", label: "Naloxone + peer recovery" },
  { name: "Package", label: "Policy package" },
  { name: "Package_noFent", label: "Policy package without fentanyl lever" },
  { name: "Package_RR", label: "Policy package (treatment and harm reduction)" },
];

export type Answer = {
  id: string;
  label: string;
  how: string;
  variable: string;
  higherIsBetter: boolean;
  value: (runs: Runs, whatIf: WhatIf) => number;
};

export const ANSWERS: Answer[] = [
  {
    id: "deaths-ahead",
    label: "Overdose deaths, 2020–2032",
    how: "Running total of projected overdose deaths at the end of the run",
    variable: "projected cumulative overdose deaths",
    higherIsBetter: false,
    value: (runs, w) => runs.valueAt(runs.current(w), "projected cumulative overdose deaths", Infinity),
  },
  {
    id: "deaths-2032",
    label: "Overdose deaths per year in 2032",
    how: "Total overdose deaths in the final year",
    variable: "total overdose deaths",
    higherIsBetter: false,
    value: (runs, w) => runs.valueAt(runs.current(w), "total overdose deaths", Infinity),
  },
  {
    id: "naloxone",
    label: "Deaths averted by naloxone, 1999–2020",
    how: "Running total of deaths averted by naloxone kits, in 2020",
    variable: "cumulative nx utilization deaths averted",
    higherIsBetter: true,
    value: (runs, w) => runs.valueAt(runs.current(w), "cumulative nx utilization deaths averted", 2020),
  },
  {
    id: "fentanyl",
    label: "Deaths attributable to fentanyl, 1999–2020",
    how: "Difference between two runs: this world minus the same world where fentanyl never arrived",
    variable: "switch for no fentanyl",
    higherIsBetter: false,
    value: (runs, w) =>
      runs.valueAt(runs.current(w), "cumulative overdose deaths", 2020) -
      runs.valueAt(runs.current({ ...w, noFentanyl: true }), "cumulative overdose deaths", 2020),
  },
];

export class Runs {
  private bundle: Bundle;
  private model: CompiledModel;
  private cache = new Map<string, RunResult>();
  lastRunMs = 0;

  constructor(bundle: Bundle, model: CompiledModel) {
    this.bundle = bundle;
    this.model = model;
  }

  current(w: WhatIf): RunResult {
    return this.run(this.overrides(w), w.edits);
  }

  // The same future with actual history, no policy and no hand edits.
  reference(w: WhatIf): RunResult {
    return this.current({ future: w.future, noFentanyl: false, lever: "None", strength: "20", edits: new Map() });
  }

  isReference(w: WhatIf): boolean {
    return !w.noFentanyl && w.lever === "None" && w.edits.size === 0;
  }

  // The name of Vensim's own published run for this what-if, if there is one.
  publishedName(w: WhatIf): string | null {
    if (w.edits.size || w.lever !== "None") return null;
    if (w.noFentanyl) return w.future === "Base" ? "NoFentHist" : null;
    return this.bundle.scenarios.find((s) => s.name === w.future)?.hasPublishedRun ? w.future : null;
  }

  leverFile(w: WhatIf): string | null {
    if (w.lever === "None") return null;
    const names = this.bundle.scenarios.map((s) => s.name);
    const withStrength = w.strength === "20" ? w.lever : `${w.lever}${w.strength}`;
    return names.includes(withStrength) ? withStrength : w.lever;
  }

  hasStrengths(lever: string): boolean {
    return this.bundle.scenarios.some((s) => s.name === `${lever}10`);
  }

  overrides(w: WhatIf): Override[] {
    const names = [w.future];
    const lever = this.leverFile(w);
    if (lever) names.push(lever);
    return [...scenarioOverrides(this.bundle, names), ...(w.noFentanyl ? this.counterfactualOverrides() : [])];
  }

  valueAt(run: RunResult, variable: string, time: number): number {
    const cell = this.model.variables.get(variable)?.cells[0];
    if (cell === undefined) return NaN;
    const t0 = run.times[0];
    const dt = run.times[1] - run.times[0];
    const step = time === Infinity ? run.times.length - 1 : Math.round((time - t0) / dt);
    return run.values[step * run.cellCount + cell];
  }

  // Only the lines of NoFentHist.cin that differ from Base.cin, so the counterfactual can be
  // combined with any future without resetting that future's own assumptions.
  private counterfactualOverrides(): Override[] {
    const base = new Map(this.bundle.scenarios.find((s) => s.name === "Base")!.overrides.map((o) => [parseCellName(o.target).variable, o.value]));
    const noFent = this.bundle.scenarios.find((s) => s.name === "NoFentHist")!;
    return noFent.overrides.filter((o) => base.get(parseCellName(o.target).variable) !== o.value);
  }

  private run(overrides: Override[], edits: Map<number, number>): RunResult {
    const signature = JSON.stringify([overrides, [...edits]]);
    const cached = this.cache.get(signature);
    if (cached) {
      this.cache.delete(signature);
      this.cache.set(signature, cached);
      return cached;
    }
    const started = performance.now();
    const constants = this.model.defaults();
    this.model.applyOverrides(constants, overrides);
    for (const [cell, value] of edits) constants[cell] = value;
    const result = this.model.simulate(constants);
    this.lastRunMs = performance.now() - started;
    this.cache.set(signature, result);
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
}
