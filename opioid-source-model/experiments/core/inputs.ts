// Node-only: gathers everything the browser needs from the SOURCE repository into one bundle.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMdl, type ParsedMdl } from "./mdl.ts";
import { buildRangeTable, cellKey, expandDefinition, parseCellName, type DataSeries, type Override } from "./compile.ts";

const CORE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = join(CORE_DIR, "..", "..", "source-model");

export const FILES = {
  model: "Vensim Files/OSM_Master_CURRENT.mdl",
  scenarios: "Vensim Files/Scenario Files",
  calibrationWeights: "Vensim Files/CalWts220120.cin",
  projectionEndValues: "Vensim Files/ProjEndVals.cin",
  fittedValues: "Analysis & Graphing/X8_IterCal/X8_main_full.out",
  controlFile: "Analysis & Graphing/OICC220127.txt",
  parameterSamples: "Publication Figures & Results Summary/Raw Results/X8_main_sample_frac.tab",
  results: "Publication Figures & Results Summary/Raw Results",
  dataFiles: ["Vensim Files/inputtimeseries.vdf", "Vensim Files/validationtimeseries.vdf", "Vensim Files/monthlytimeseries.vdf", "Vensim Files/yearsubs.vdf"],
};

export type FittedValue = { target: string; value: number; lower: number; upper: number };

export type ScenarioKind = "future" | "counterfactual" | "lever" | "test";

export type Scenario = { name: string; file: string; kind: ScenarioKind; overrides: Override[]; hasPublishedRun: boolean };

export type Bundle = {
  files: typeof FILES;
  mdl: ParsedMdl;
  data: Record<string, DataSeries>;
  dataSourceRun: string;
  baseChanges: { file: string; overrides: Override[] }[];
  fitted: FittedValue[];
  fitStats: string[];
  scenarios: Scenario[];
  samples: { names: string[]; rows: number[][] };
};

export function loadBundle(): Bundle {
  const mdl = parseMdl(read(FILES.model));
  const dataSourceRun = "X8_final_Base";
  const control = JSON.parse(read(FILES.controlFile));
  const { fitted, stats } = readFittedValues();
  return {
    files: FILES,
    mdl,
    data: extractDataPoints(mdl, readTab(join(FILES.results, `${dataSourceRun}.tab`))),
    dataSourceRun,
    baseChanges: [FILES.calibrationWeights, FILES.projectionEndValues].map((file) => ({ file, overrides: readCin(file) })),
    fitted,
    fitStats: stats,
    scenarios: readScenarios(control),
    samples: readSamples(),
  };
}

// The published .tab results store data variables only at their actual data points (other cells
// are blank), so they double as a readable copy of the binary .vdf input files.
function extractDataPoints(mdl: ParsedMdl, tab: Tab): Record<string, DataSeries> {
  const ranges = buildRangeTable(mdl.ranges);
  const data: Record<string, DataSeries> = {};
  for (const definition of mdl.definitions.filter((d) => d.kind === "data")) {
    for (const { elements } of expandDefinition(definition, ranges)) {
      const key = cellKey(definition.key, elements);
      const row = tab.rows.get(key);
      if (!row) continue;
      const times: number[] = [];
      const values: number[] = [];
      row.forEach((value, s) => {
        if (Number.isNaN(value)) return;
        times.push(tab.times[s]);
        values.push(value);
      });
      data[key] = dropExtrapolatedTail({ times, values }, tab.times[1] - tab.times[0]);
    }
  }
  return data;
}

// For annual series that Vensim extrapolated (Population, IsYear), the .tab file also holds
// a short run of per-step values after the last real data point. Those are not data.
function dropExtrapolatedTail(series: DataSeries, timeStep: number): DataSeries {
  const gaps = series.times.slice(1).map((t, i) => Math.round((t - series.times[i]) / timeStep));
  const annual = gaps.filter((g) => g > 1).length > gaps.length / 2;
  if (!annual) return series;
  let end = series.times.length;
  while (end > 1 && gaps[end - 2] === 1) end--;
  return { times: series.times.slice(0, end), values: series.values.slice(0, end) };
}

export type Tab = { times: number[]; rows: Map<string, Float64Array> };

const tabCache = new Map<string, Tab>();

export function readTab(file: string, timeStep = 0.0625): Tab {
  if (tabCache.has(file)) return tabCache.get(file)!;
  const lines = read(file).split(/\r?\n/).filter(Boolean);
  const header = lines[0].split("\t").slice(1).map(Number);
  const times = header.map((_, s) => header[0] + s * timeStep);
  const rows = new Map<string, Float64Array>();
  for (const line of lines.slice(1)) {
    const [name, ...cells] = line.split("\t");
    const { variable, elements } = parseCellName(name);
    rows.set(
      cellKey(variable, elements),
      Float64Array.from(times, (_, s) => (cells[s] === undefined || cells[s].trim() === "" ? NaN : Number(cells[s]))),
    );
  }
  const tab = { times, rows };
  tabCache.set(file, tab);
  return tab;
}

export function publishedRunFile(scenario: string): string | null {
  const file = join(FILES.results, `X8_final_${scenario}.tab`);
  return existsSync(join(REPO_DIR, file)) ? file : null;
}

function readFittedValues(): { fitted: FittedValue[]; stats: string[] } {
  const lines = read(FILES.fittedValues).split(/\r?\n/);
  const stats = lines.filter((l) => l.startsWith(":COMSYS")).map((l) => l.replace(":COMSYS", "").trim());
  const fitted = lines.flatMap((line) => {
    const m = line.match(/^\s*([-\d.e+]+)\s*<=\s*(.+?)\s*=\s*([-\d.e+]+)\s*<=\s*([-\d.e+]+)\s*$/);
    return m ? [{ target: m[2].trim(), value: Number(m[3]), lower: Number(m[1]), upper: Number(m[4]) }] : [];
  });
  return { fitted, stats };
}

function readCin(file: string): Override[] {
  return read(file)
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith(":"))
    .map((line) => {
      const [target, value] = line.split("=");
      return { target: target.trim(), value: Number(value) };
    })
    .filter((o) => !Number.isNaN(o.value));
}

function readScenarios(control: { basescens: string[]; scenariolist: string[]; policylist: string[]; testlist: string[] }): Scenario[] {
  const kindOf = (file: string): ScenarioKind => {
    if (file === "NoFentHist.cin") return "counterfactual";
    if (control.basescens.includes(file) || control.scenariolist.includes(file)) return "future";
    if (control.policylist.includes(file)) return "lever";
    return "test";
  };
  return readdirSync(join(REPO_DIR, FILES.scenarios))
    .filter((f) => f.endsWith(".cin"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => {
      const name = f.replace(/\.cin$/, "");
      return {
        name,
        file: `${FILES.scenarios}/${f}`,
        kind: kindOf(f),
        overrides: readCin(`${FILES.scenarios}/${f}`),
        hasPublishedRun: publishedRunFile(name) !== null,
      };
    });
}

function readSamples(): { names: string[]; rows: number[][] } {
  const lines = read(FILES.parameterSamples).split(/\r?\n/).filter(Boolean);
  const names = lines[0].split("\t").map((n) => n.trim());
  return { names, rows: lines.slice(1).map((l) => l.split("\t").map(Number)) };
}

function read(file: string): string {
  return readFileSync(join(REPO_DIR, file), "utf-8");
}
