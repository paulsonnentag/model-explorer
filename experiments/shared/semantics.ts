// Gives every model variable a meaning: which layer of the argument it belongs to
// (theory, quantities, evidence, measurement, what-ifs) and where its value comes from.

import type { Bundle, FittedValue } from "../core/inputs.ts";
import type { Definition } from "../core/mdl.ts";
import { parseCellName, type CompiledModel } from "../core/compile.ts";
import { parseExpression, referencedKeys, type Expr } from "../core/expr.ts";

export type Layer = "theory" | "quantities" | "evidence" | "measurement" | "what-ifs" | "settings";

export type Role =
  | "stock"
  | "accounting"
  | "flow"
  | "mechanism"
  | "driver"
  | "fitted"
  | "literature"
  | "data-derived"
  | "assumption"
  | "expert"
  | "calibrated"
  | "constant"
  | "input-data"
  | "validation-data"
  | "measurement"
  | "future"
  | "lever"
  | "counterfactual"
  | "setting";

export type SetBy = { file: string; target: string; value: number; kind: string };

export type VarInfo = {
  key: string;
  name: string;
  modelName: string;
  layer: Layer;
  role: Role;
  definitions: Definition[];
  units: string;
  comment: string;
  tags: string[];
  sources: string[];
  uses: string[];
  usedBy: string[];
  flows: { stock: string; sign: 1 | -1 }[];
  sectors: string[];
  fitted: FittedValue | null;
  setBy: SetBy[];
  measuredAs: { element: string; data: string }[];
  measures: { element: string; model: string }[];
  cells: number[];
};

export type Sector = { name: string; description: string; keys: string[] };

export type Semantics = { vars: Map<string, VarInfo>; sectors: Sector[] };

export const LAYERS: Record<Layer, { title: string; color: string; description: string }> = {
  theory: {
    title: "Theory",
    color: "#2f6db5",
    description: "How the system works: the groups people move between, the flows between them, and the forces that speed those flows up or slow them down.",
  },
  quantities: {
    title: "Quantities",
    color: "#c47f12",
    description: "How strong each effect is. Some numbers come from the literature or expert judgment; the most uncertain ones were fitted to 1999–2020 data.",
  },
  evidence: {
    title: "Evidence",
    color: "#2e8a57",
    description: "What was actually observed: national surveys, prescription counts, death records and treatment counts.",
  },
  measurement: {
    title: "Measurement",
    color: "#7a57b8",
    description: "How the model's quantities are compared with what each data source reports, and how much each data source is trusted.",
  },
  "what-ifs": {
    title: "What-ifs",
    color: "#c7473a",
    description: "Assumptions about the future nobody controls, policy levers someone could pull, and histories that did not happen.",
  },
  settings: {
    title: "Settings",
    color: "#8a8a8a",
    description: "Simulation settings and switches for testing alternative formulations.",
  },
};

export const ROLES: Record<Role, { label: string; layer: Layer; description: string }> = {
  stock: { label: "Group of people", layer: "theory", description: "A stock: a number of people in one state. It only changes through the flows in and out of it." },
  accounting: { label: "Running total", layer: "theory", description: "A stock that adds up an outcome over time, such as cumulative deaths." },
  flow: { label: "Flow", layer: "theory", description: "People moving from one state to another per year: starting, becoming addicted, entering treatment, relapsing, dying." },
  mechanism: { label: "Mechanism", layer: "theory", description: "An intermediate quantity in the causal story, computed from other variables." },
  driver: {
    label: "External driver",
    layer: "theory",
    description: "An outside force on the system (prescribing, drug supply, treatment capacity). History comes from data; the future from projection assumptions.",
  },
  fitted: { label: "Fitted to data", layer: "quantities", description: "Unknown when the model was built; estimated by searching for the value that best reproduces 1999–2020 data." },
  literature: { label: "From literature", layer: "quantities", description: "Taken from published studies." },
  "data-derived": { label: "From data", layer: "quantities", description: "Computed directly from a data source." },
  assumption: { label: "Assumption", layer: "quantities", description: "Set by the modelers' judgment." },
  expert: { label: "Expert judgment", layer: "quantities", description: "Set from expert input." },
  calibrated: { label: "Hand-calibrated", layer: "quantities", description: "Tuned to fit data in an earlier calibration step and then fixed." },
  constant: { label: "Constant", layer: "quantities", description: "A fixed number without a documented source tag." },
  "input-data": { label: "Input data", layer: "evidence", description: "A historical data series that drives the model directly." },
  "validation-data": { label: "Calibration data", layer: "evidence", description: "A historical data series the model is compared against when fitting." },
  measurement: { label: "Measurement", layer: "measurement", description: "Part of how model output is compared with data: error terms, weights and priors." },
  future: { label: "Future assumption", layer: "what-ifs", description: "An assumption about 2021–2032 that differs between the future scenarios." },
  lever: { label: "Policy lever", layer: "what-ifs", description: "Something a policymaker could change. Policy scenarios set these from 2022 onward." },
  counterfactual: { label: "Counterfactual switch", layer: "what-ifs", description: "Rewrites history to ask what caused what, e.g. a world where illicit fentanyl never arrived." },
  setting: { label: "Setting", layer: "settings", description: "A simulation setting or a switch for testing alternative formulations." },
};

export const TAGS: Record<string, string> = {
  LIT: "literature",
  DATA: "data",
  ASM: "assumption",
  EXP: "expert judgment",
  ACAL: "automatic calibration",
  MCAL: "manual calibration",
  PMC: "partial model calibration",
};

const SECTOR_DESCRIPTIONS: Record<string, string> = {
  "User stocks & flows": "The 14 groups of people and the transitions between them.",
  "Opioid Prescribing and Supply": "How many patients get opioid prescriptions, for how long and at what dose.",
  "Rx street market availability and price": "Diversion of prescription opioids to the street, and how availability and price respond.",
  Treatment: "Medication treatment for addiction: capacity, who enters and who leaves.",
  "Naloxone and ODs": "Overdose risk for each group, fentanyl's effect, and lives saved by naloxone.",
  "Rx and Heroin availability feedback": "Feedback: availability of pills and heroin changes how many people start.",
  "Social influence feedback": "Reinforcing feedback: the more people use, the more others start.",
  "Perceived risk feedback": "Balancing feedback: overdose deaths make drugs seem riskier, so fewer start.",
  "Policy and Projection drivers": "Projection curves for 2021–2032 and the policy levers.",
  "Output Variables": "Totals reported as results.",
  "Data variables": "Historical data series.",
  Calibration: "Comparison of model output with data.",
  Dashboard: "Summary panel used when running the model interactively.",
};

export function buildSemantics(bundle: Bundle, model: CompiledModel): Semantics {
  const byKey = new Map<string, Definition[]>();
  for (const d of bundle.mdl.definitions) byKey.set(d.key, [...(byKey.get(d.key) ?? []), d]);

  const setBy = collectSetBy(bundle);
  const fitted = new Map(bundle.fitted.map((f) => [parseCellName(f.target).variable, f]));
  const futureKeys = keysThatDifferAcross(bundle, "future");
  const counterfactualKeys = keysThatDifferAcross(bundle, "counterfactual");
  const parsed = new Map<string, Expr[]>();
  for (const [key, defs] of byKey) parsed.set(key, defs.flatMap((d) => (d.expression ? [safeParse(d.expression)] : [])).filter((e): e is Expr => !!e));
  const flowsByVar = collectFlows(parsed, model);

  const vars = new Map<string, VarInfo>();
  for (const [key, defs] of byKey) {
    const first = defs[0];
    const exprs = parsed.get(key)!;
    const uses = new Set<string>();
    for (const e of exprs) referencedKeys(e, uses);
    uses.delete("time");
    const variable = model.variables.get(key);
    const info: VarInfo = {
      key,
      name: first.name,
      modelName: first.name,
      layer: "theory",
      role: "mechanism",
      definitions: defs,
      units: defs.find((d) => d.units)?.units ?? "",
      comment: defs.find((d) => d.comment)?.comment ?? "",
      tags: sourceTags(defs),
      sources: [...(defs.find((d) => d.comment)?.comment ?? "").matchAll(/\[Source:\s*([^\]]+)\]?/gi)].map((m) => m[1].replace(/[\])]$/, "").trim()),
      uses: [...uses].filter((u) => byKey.has(u)),
      usedBy: [],
      flows: flowsByVar.get(key) ?? [],
      sectors: bundle.mdl.views.filter((v) => v.name !== "ChangeLog" && v.variableKeys.includes(key)).map((v) => v.name),
      fitted: fitted.get(key) ?? null,
      setBy: setBy.get(key) ?? [],
      measuredAs: [],
      measures: [],
      cells: variable?.cells ?? [],
    };
    info.role = classify(info, model, futureKeys, counterfactualKeys);
    info.layer = ROLES[info.role].layer;
    vars.set(key, info);
  }
  for (const info of vars.values()) for (const used of info.uses) vars.get(used)?.usedBy.push(info.key);
  linkMeasurements(byKey, vars);

  const sectors = bundle.mdl.views
    .filter((v) => v.name !== "ChangeLog" && v.variableKeys.some((k) => vars.has(k)))
    .map((v) => ({ name: v.name, description: SECTOR_DESCRIPTIONS[v.name] ?? "", keys: v.variableKeys.filter((k) => vars.has(k)) }));
  return { vars, sectors };
}

function classify(info: VarInfo, model: CompiledModel, futureKeys: Set<string>, counterfactualKeys: Set<string>): Role {
  const group = info.definitions[0].group.toLowerCase();
  const kinds = info.cells.map((c) => model.cells[c].kind);
  if (group === "control") return "setting";
  if (info.key.startsWith("policy change") || info.key === "policy activation time" || info.key === "policy rampup duration") return "lever";
  if (counterfactualKeys.has(info.key)) return "counterfactual";
  if (futureKeys.has(info.key)) return "future";
  if (info.fitted) return "fitted";
  if (info.definitions.some((d) => d.kind === "data") && group !== "calibration") return group === "validation" ? "validation-data" : "input-data";
  if (group === "calibration" || group === "validation") return "measurement";
  if (kinds.includes("stock")) return /cumulative/i.test(info.modelName) ? "accounting" : "stock";
  if (info.flows.length) return "flow";
  if (kinds.length && kinds.every((k) => k === "const")) {
    if (info.key.startsWith("switch")) return "setting";
    const tagRole: Record<string, Role> = { LIT: "literature", DATA: "data-derived", ASM: "assumption", EXP: "expert", ACAL: "calibrated", MCAL: "calibrated", PMC: "calibrated" };
    return tagRole[info.tags[0]] ?? "constant";
  }
  if (group === "input" || group === "policy") return "driver";
  return "mechanism";
}

function sourceTags(defs: Definition[]): string[] {
  const comment = defs.map((d) => d.comment).join(" ");
  const tags = [...comment.matchAll(/\[([A-Z]{2,5}(?:\s*,\s*[A-Z]{2,5})*)\]/g)].flatMap((m) => m[1].split(",").map((t) => t.trim()));
  return [...new Set(tags.filter((t) => t in TAGS))];
}

function collectSetBy(bundle: Bundle): Map<string, SetBy[]> {
  const result = new Map<string, SetBy[]>();
  const add = (target: string, value: number, file: string, kind: string) => {
    const key = parseCellName(target).variable;
    result.set(key, [...(result.get(key) ?? []), { file, target, value, kind }]);
  };
  for (const change of bundle.baseChanges) for (const o of change.overrides) add(o.target, o.value, change.file, "base change");
  for (const f of bundle.fitted) add(f.target, f.value, bundle.files.fittedValues, "fitted value");
  for (const s of bundle.scenarios) for (const o of s.overrides) add(o.target, o.value, s.file, s.kind);
  return result;
}

// A key is a future assumption if the future scenario files disagree about it (or it comes
// from the projection end-value file); a counterfactual switch if only that history sets it.
function keysThatDifferAcross(bundle: Bundle, kind: "future" | "counterfactual"): Set<string> {
  const base = new Map(bundle.scenarios.find((s) => s.name === "Base")!.overrides.map((o) => [parseCellName(o.target).variable, o.value]));
  const keys = new Set<string>();
  if (kind === "counterfactual") {
    for (const s of bundle.scenarios.filter((s) => s.kind === "counterfactual"))
      for (const o of s.overrides) if (base.get(parseCellName(o.target).variable) !== o.value) keys.add(parseCellName(o.target).variable);
    return keys;
  }
  for (const change of bundle.baseChanges.filter((c) => c.file.includes("ProjEndVals"))) for (const o of change.overrides) keys.add(parseCellName(o.target).variable);
  for (const s of bundle.scenarios.filter((s) => s.kind === "future"))
    for (const o of s.overrides) if (base.get(parseCellName(o.target).variable) !== o.value) keys.add(parseCellName(o.target).variable);
  return keys;
}

// A stock's INTEG rate is a signed sum of flows; the sign says whether a flow fills or drains it.
function collectFlows(parsed: Map<string, Expr[]>, model: CompiledModel): Map<string, { stock: string; sign: 1 | -1 }[]> {
  const result = new Map<string, { stock: string; sign: 1 | -1 }[]>();
  for (const [stock, exprs] of parsed) {
    for (const expr of exprs) {
      if (expr.type !== "call" || expr.fn !== "INTEG") continue;
      const walk = (e: Expr, sign: 1 | -1) => {
        if (e.type === "ref") {
          if (!model.variables.has(e.key)) return;
          const list = result.get(e.key) ?? [];
          if (!list.some((f) => f.stock === stock && f.sign === sign)) list.push({ stock, sign });
          result.set(e.key, list);
        } else if (e.type === "binary" && (e.op === "+" || e.op === "-")) {
          walk(e.left, sign);
          walk(e.right, e.op === "-" ? (-sign as 1 | -1) : sign);
        } else if (e.type === "unary" && e.op === "-") walk(e.arg, -sign as 1 | -1);
        else if (e.type === "call" && e.fn === "SUM") walk(e.args[0], sign);
      };
      walk(expr.args[0], 1);
    }
  }
  return result;
}

// The calibration section pairs each model output with a data series by element, e.g.
// SimVar[ODTo] = Total overdose deaths and DataVarBase[ODTo] = Total overdose deaths NVSS.
function linkMeasurements(byKey: Map<string, Definition[]>, vars: Map<string, VarInfo>) {
  const single = (key: string) => {
    const out = new Map<string, string>();
    for (const d of byKey.get(key) ?? []) {
      const e = d.expression ? safeParse(d.expression) : null;
      if (e?.type === "ref" && vars.has(e.key) && d.subscripts.length === 1) out.set(d.subscripts[0], e.key);
    }
    return out;
  };
  for (const [simKey, dataKey] of [
    ["simvar", "datavarbase"],
    ["simprior", "datapriorbase"],
  ]) {
    const sims = single(simKey);
    const datas = single(dataKey);
    for (const [element, model] of sims) {
      const data = datas.get(element);
      if (!data) continue;
      vars.get(model)!.measuredAs.push({ element, data });
      vars.get(data)!.measures.push({ element, model });
    }
  }
}

function safeParse(source: string): Expr | null {
  try {
    return parseExpression(source);
  } catch {
    return null;
  }
}
