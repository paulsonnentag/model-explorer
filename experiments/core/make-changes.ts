// Writes the patches and published results behind opioid-model/changes/: the one change the authors
// made to the model after publishing it (from the SOURCE repository's history), a loop knockout from
// their sensitivity analysis, and a made-up structural change. The .md files describing each change
// are ours and left alone.
// Usage: node experiments/core/make-changes.ts

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_DIR } from "./inputs.ts";
import { MODEL_DIR } from "./model-folder.ts";

const FIX_COMMIT = "f0b1756";
const MODEL_IN_REPO = "Model & Analysis Replication Package/OSM_Master_CURRENT.mdl";
const RESULTS = "Analysis & Graphing/X8_IterCal/Results";
const PUBLISHED_VARIABLES = ["Total overdose deaths", "Total with UD", "HUD total", "Total heroin initiation", "Projected cumulative overdose deaths", "Projected cumulative UD person years"];

// The heroin availability family of the authors' "lkdict" (OICC220127.txt), knocked out by setting
// each strength to 0.
const AVAILABILITY_STRENGTHS = [
  "Heroin availability strength developing HUD",
  "Heroin availability strength initiating NDHU no Rx",
  "Heroin availability strength net quit NDHU",
  "Rx availability strength developing Rx OUD",
  "Rx availability strength initiating Rx misuse",
  "Rx availability strength net quit Rx misuse",
  "Rx vs H availability strength developing HUD with Rx OUD",
  "Rx vs H availability strength initiating heroin with Rx OUD",
  "Rx vs H availability strength initiating NDHU with Rx",
];

main();

function main() {
  write("changes/01-resubmission-fix.patch", fixPatch());
  write("changes/01-resubmission-fix.tsv", published({ before: [`${FIX_COMMIT}^`, "X8_final_Base_vars.tab"], after: [FIX_COMMIT, "X8_final_Base_vars.tab"] }));
  write("changes/02-knockout-availability.patch", newFilePatch("what-ifs/tests/KnockoutAv.cin", AVAILABILITY_STRENGTHS.map((s) => `${s} = 0`)));
  write("changes/02-knockout-availability.tsv", published({ before: ["HEAD", "X8_final_Base_vars.tab"], after: ["HEAD", "X8_lk_run_av_Base_vars.tab"], refitted: ["HEAD", "X8_lk_av_Base_vars.tab"] }));
  write("changes/05-stable-relapse.patch", modelPatch(stableRelapse(read("model.mdl"))));
  console.log(`Wrote ${MODEL_DIR}/changes`);
}

// The commit's diff of the model, as it applies to model.mdl (the same file, copied unchanged).
function fixPatch(): string {
  const diff = git("diff", `${FIX_COMMIT}^`, FIX_COMMIT, "--", MODEL_IN_REPO);
  return diff.split(`a/${MODEL_IN_REPO}`).join("a/model.mdl").split(`b/${MODEL_IN_REPO}`).join("b/model.mdl");
}

// A new relapse flow out of stable remission, back into HUD; the Vensim diagrams are left as they are.
function stableRelapse(model: string): string {
  const eol = model.includes("\r\n") ? "\r\n" : "\n";
  const lines = [
    "Relapsing from stable remission HUD=",
    "\tHUD in stable remission ",
    "\t             * Relapse rate HUD net * Relapse rate stable remission relative * Social influence coefficient relapse",
    "\t~\tperson/Years",
    "\t~\tReturn to heroin use disorder after remission has stabilized, at a fraction of \\",
    "\t\tthe relapse rate from early remission.",
    "\t|",
    "",
    "Relapse rate stable remission relative = 0.1",
    "\t~\tdmnl [0,1]",
    "\t~\t[ASSUMPTION] Relapse risk once remission has stabilized, relative to early remission.",
    "\t|",
    "",
    "",
  ].join(eol);
  return replaceOnce(
    replaceOnce(
      replaceOnce(model, `Relapsing to Rx OUD with H=${eol}`, `${lines}Relapsing to Rx OUD with H=${eol}`),
      `\tStabilizing remission HUD-NonOD death HUD in stable remission,${eol}`,
      `\tStabilizing remission HUD-NonOD death HUD in stable remission-Relapsing from stable remission HUD,${eol}`,
    ),
    `                  + Relapsing to HUD ${eol}                  + SUM ( Tx exit with UD HUD`,
    `                  + Relapsing to HUD ${eol}                  + Relapsing from stable remission HUD ${eol}                  + SUM ( Tx exit with UD HUD`,
  );
}

function modelPatch(edited: string): string {
  const dir = mkdtempSync(join(tmpdir(), "change-"));
  writeFileSync(join(dir, "edited.mdl"), edited);
  const diff = spawnSync("git", ["diff", "--no-index", "--no-color", join(MODEL_DIR, "model.mdl"), join(dir, "edited.mdl")], { encoding: "utf-8", maxBuffer: 1 << 28 }).stdout;
  rmSync(dir, { recursive: true, force: true });
  return diff.replace(/^diff --git .*$/m, "diff --git a/model.mdl b/model.mdl").replace(/^index .*\n/m, "").replace(/^--- .*$/m, "--- a/model.mdl").replace(/^\+\+\+ .*$/m, "+++ b/model.mdl");
}

function newFilePatch(path: string, lines: string[]): string {
  return [`diff --git a/${path} b/${path}`, "new file mode 100644", "--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`), ""].join("\n");
}

// Yearly values of a few outputs from the authors' published runs, one row per point.
function published(sides: Record<string, [string, string]>): string {
  const rows = Object.entries(sides).flatMap(([side, [commit, file]]) => {
    const lines = git("show", `${commit}:${RESULTS}/${file}`).split(/\r?\n/).filter(Boolean);
    const times = lines[0].split("\t").slice(1).map(Number);
    return lines.slice(1).flatMap((line) => {
      const [name, ...cells] = line.split("\t");
      if (!PUBLISHED_VARIABLES.includes(name)) return [];
      return times.flatMap((t, i) => (Number.isInteger(t) && cells[i]?.trim() ? [`${name}\t${side}\t${t}\t${Number(cells[i])}`] : []));
    });
  });
  const files = Object.entries(sides).map(([side, [commit, file]]) => `${side} = ${file} at ${commit}`).join(", ");
  return [`# The authors' published runs, yearly: ${files}, in ${RESULTS}.`, "variable\tside\ttime\tvalue", ...rows, ""].join("\n");
}

function replaceOnce(text: string, find: string, replace: string): string {
  const at = text.indexOf(find);
  if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`Expected exactly one match for ${JSON.stringify(find.slice(0, 60))}`);
  return text.slice(0, at) + replace + text.slice(at + find.length);
}

function git(...args: string[]): string {
  return execFileSync("git", ["-C", REPO_DIR, ...args], { encoding: "utf-8", maxBuffer: 1 << 28 });
}

function read(file: string): string {
  return readFileSync(join(MODEL_DIR, file), "utf-8");
}

function write(file: string, text: string) {
  writeFileSync(join(MODEL_DIR, file), text);
}
