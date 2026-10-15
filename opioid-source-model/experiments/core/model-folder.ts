// Node-only: reads opioid-source-model/opioid-model/, the sorted copy of the authors' package that the
// trail view runs from, into the same bundle the other experiments build from the original repository.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DataSeries } from "./compile.ts";
import { type Bundle, type Scenario, type ScenarioKind, parseCin, parseFittedValues } from "./inputs.ts";
import { parseMdl } from "./mdl.ts";

export const MODEL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "opioid-model");

export const LAYOUT = {
  model: "model.mdl",
  everyRun: "every-run",
  whatIfs: "what-ifs",
  data: "data/historical.tsv",
  findings: "findings",
  papers: "papers",
};

// Applied in this order before any what-if, as in the authors' runs.
const EVERY_RUN = ["CalWts220120.cin", "ProjEndVals.cin"];
const FITTED = "X8_main_full.out";
const KINDS: Record<string, ScenarioKind> = { futures: "future", history: "counterfactual", policies: "lever", tests: "test" };

export type ModelFolder = Bundle & { findings: { file: string; text: string }[]; papers: string[] };

export function loadModelFolder(): ModelFolder {
  const { fitted, stats } = parseFittedValues(read(`${LAYOUT.everyRun}/${FITTED}`));
  return {
    files: {
      model: LAYOUT.model,
      scenarios: LAYOUT.whatIfs,
      calibrationWeights: `${LAYOUT.everyRun}/${EVERY_RUN[0]}`,
      projectionEndValues: `${LAYOUT.everyRun}/${EVERY_RUN[1]}`,
      fittedValues: `${LAYOUT.everyRun}/${FITTED}`,
      controlFile: "",
      parameterSamples: "",
      results: "",
      dataFiles: list("data"),
    },
    mdl: parseMdl(read(LAYOUT.model)),
    data: readData(),
    dataSourceRun: LAYOUT.data,
    baseChanges: EVERY_RUN.map((name) => ({ file: `${LAYOUT.everyRun}/${name}`, overrides: parseCin(read(`${LAYOUT.everyRun}/${name}`)) })),
    fitted,
    fitStats: stats,
    scenarios: readWhatIfs(),
    samples: { names: [], rows: [] },
    findings: list(LAYOUT.findings)
      .filter((f) => f.endsWith(".md"))
      .map((file) => ({ file, text: read(file) })),
    papers: list(LAYOUT.papers).filter((f) => f.endsWith(".pdf")),
  };
}

function readWhatIfs(): Scenario[] {
  return Object.entries(KINDS).flatMap(([folder, kind]) =>
    list(`${LAYOUT.whatIfs}/${folder}`)
      .filter((f) => f.endsWith(".cin"))
      .map((file) => ({ name: file.split("/").pop()!.replace(/\.cin$/, ""), file, kind, overrides: parseCin(read(file)), hasPublishedRun: false })),
  );
}

function readData(): Record<string, DataSeries> {
  const data: Record<string, DataSeries> = {};
  for (const line of read(LAYOUT.data).split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith("variable\t")) continue;
    const [key, time, value] = line.split("\t");
    data[key] ??= { times: [], values: [] };
    data[key].times.push(Number(time));
    data[key].values.push(Number(value));
  }
  return data;
}

function list(folder: string): string[] {
  return readdirSync(join(MODEL_DIR, folder))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => `${folder}/${name}`);
}

function read(file: string): string {
  return readFileSync(join(MODEL_DIR, file), "utf-8");
}
