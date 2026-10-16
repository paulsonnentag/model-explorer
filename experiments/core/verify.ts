// Runs a scenario with our engine and compares every cell with Vensim's published run.
// Usage: node experiments/core/verify.ts [Scenario]   (default: Base)

import { loadBundle, publishedRunFile, readTab } from "./inputs.ts";
import { compileModel, NA } from "./compile.ts";
import { scenarioOverrides } from "./scenario.ts";

const scenarioName = process.argv[2] ?? "Base";

main();

function main() {
  const bundle = loadBundle();
  const started = performance.now();
  const model = compileModel({ definitions: bundle.mdl.definitions, ranges: bundle.mdl.ranges, data: bundle.data });
  const compiledAt = performance.now();
  const constants = model.defaults();
  const unresolved = model.applyOverrides(constants, scenarioOverrides(bundle, [scenarioName]));
  const result = model.simulate(constants);
  const ranAt = performance.now();

  console.log(`${model.cells.length} cells, compiled in ${(compiledAt - started).toFixed(0)} ms, ran in ${(ranAt - compiledAt).toFixed(0)} ms`);
  if (model.problems.length) console.log(`\n${model.problems.length} compile problems:\n  ${model.problems.slice(0, 400).join("\n  ")}`);
  if (unresolved.length) console.log(`\nOverrides that matched no constant: ${unresolved.join(", ")}`);

  const file = publishedRunFile(scenarioName);
  if (!file) return console.log(`No published run for ${scenarioName}`);
  compare(model, result, readTab(file));
}

function compare(model: ReturnType<typeof compileModel>, result: ReturnType<ReturnType<typeof compileModel>["simulate"]>, tab: ReturnType<typeof readTab>) {
  const rows: { label: string; kind: string; error: number; step: number; ours: number; theirs: number }[] = [];
  let compared = 0;
  for (const cell of model.cells) {
    if (cell.hidden) continue;
    const reference = tab.rows.get(cell.key);
    if (!reference) continue;
    compared++;
    const ours = result.series(cell.index);
    let worst = { error: 0, step: -1, ours: 0, theirs: 0 };
    for (let s = 0; s < Math.min(ours.length, reference.length); s++) {
      const theirs = reference[s];
      if (Number.isNaN(theirs)) continue;
      const mine = ours[s] === NA ? NaN : ours[s];
      const error = Number.isNaN(mine) ? 1 : Math.abs(mine - theirs) / Math.max(Math.abs(theirs), 1e-9);
      if (error > worst.error) worst = { error, step: s, ours: mine, theirs };
    }
    if (worst.error > 1e-4) rows.push({ label: cell.label, kind: cell.kind, ...worst });
  }
  const missing = model.cells.filter((c) => !c.hidden && !tab.rows.has(c.key)).length;
  console.log(`\nCompared ${compared} cells with the published run (${missing} cells not in the published file).`);
  console.log(`${compared - rows.length} match within 0.01%; ${rows.length} differ.`);
  rows
    .sort((a, b) => a.step - b.step || b.error - a.error)
    .slice(0, 40)
    .forEach((r) =>
      console.log(`  t=${result.times[r.step]?.toFixed(4)} ${(r.error * 100).toFixed(3)}%  ${r.kind.padEnd(14)} ${r.label}  ours=${r.ours} vensim=${r.theirs}`),
    );
}
