// Generates ../index.html and ./parts/*.txt from the FDA SOURCE Vensim model.
// Run from anywhere: node opioid-source-model/explorer/build.ts

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EXPLORER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(EXPLORER_DIR, "..");
const REPO_DIR = join(ROOT_DIR, "source-model");
const MODEL_PATH = "Vensim Files/OSM_Master_CURRENT.mdl";
const SCENARIO_DIR = "Vensim Files/Scenario Files";
const PARTS_DIR = join(EXPLORER_DIR, "parts");

type Equation = { name: string; key: string; raw: string; isStock: boolean };
type View = { name: string; slug: string; file: string; variableKeys: string[] };
type Flow = { name: string; from: string[]; to: string[] };
type Scenario = { name: string; file: string; overrides: [string, string][]; isPolicy: boolean };
type Model = {
  equations: Map<string, Equation[]>;
  views: View[];
  flows: Flow[];
  changelog: string[];
};

function main() {
  const model = parseModel(readFileSync(join(REPO_DIR, MODEL_PATH), "utf-8"));
  const scenarios = readScenarios();
  writeParts(model);
  writeFileSync(join(ROOT_DIR, "index.html"), renderPage(model, scenarios));
  console.log(
    `Wrote index.html: ${model.equations.size} variables, ${stockCount(model)} stocks, ` +
      `${model.views.length} views, ${scenarios.length} scenarios`,
  );
}

// ---------------------------------------------------------------------------
// Parsing the .mdl file

function parseModel(source: string): Model {
  const [equationPart, ...sketchParts] = source.split("\\\\\\---/// Sketch information");
  const equations = parseEquations(equationPart);
  const views = parseViews(sketchParts.join("\n"));
  return {
    equations,
    views: views.filter((v) => v.variableKeys.some((k) => equations.has(k))).map(withFile),
    flows: parseFlows(equations),
    changelog: parseChangelog(sketchParts.join("\n")),
  };
}

function parseEquations(equationPart: string): Map<string, Equation[]> {
  const equations = new Map<string, Equation[]>();
  for (const block of equationPart.replace("{UTF-8}", "").split("|")) {
    const raw = block.replace(/^\s*\n/, "").trimEnd();
    if (!raw.trim() || raw.trim().startsWith("*")) continue;
    const flat = raw.replace(/\\\n\s*/g, " ");
    const match = flat.match(/^\s*("[^"]+"|[^=~(\[:]+?)\s*(\[[^\]]*\])?\s*(:=|=|~|\(|:)/);
    if (!match) continue;
    const name = match[1].replace(/"/g, "").trim();
    const definition = flat.split("~")[0];
    const equation = { name, key: normalize(name), raw, isStock: /=\s*INTEG\s*\(/.test(definition) };
    const existing = equations.get(equation.key) ?? [];
    equations.set(equation.key, [...existing, equation]);
  }
  return equations;
}

function parseViews(sketch: string): Pick<View, "name" | "variableKeys">[] {
  const chunks = sketch.split(/\n\*(?=[^\n]+\n\$)/).slice(1);
  return chunks.map((chunk) => {
    const keys = chunk
      .split("\n")
      .filter((line) => line.startsWith("10,"))
      .map((line) => normalize(sketchName(line)));
    return { name: chunk.split("\n", 1)[0].trim(), variableKeys: [...new Set(keys)] };
  });
}

function withFile(view: Pick<View, "name" | "variableKeys">, index: number): View {
  const slug = `${String(index + 1).padStart(2, "0")}-${view.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`;
  return { ...view, slug, file: `explorer/parts/${slug}.txt` };
}

function sketchName(line: string): string {
  const rest = line.replace(/^10,\d+,/, "");
  if (rest.startsWith('"')) return rest.slice(1, rest.indexOf('"', 1));
  return rest.slice(0, rest.indexOf(","));
}

function parseChangelog(sketch: string): string[] {
  const view = sketch.split(/\n\*ChangeLog\n/)[1] ?? "";
  return view
    .split("///---\\\\\\")[0]
    .split("\n")
    .filter((line) => /^\d{6} - /.test(line.trim()))
    .map((line) => line.trim());
}

// A stock's INTEG first argument is a signed sum of flows, sometimes wrapped
// in SUM(...) over subscripts, so signs are tracked through parentheses.
function parseFlows(equations: Map<string, Equation[]>): Flow[] {
  const flows = new Map<string, Flow>();
  for (const [, [stockEquation]] of stocks(equations)) {
    const stock = stockEquation.name;
    for (const { name, sign } of integTerms(stockEquation.raw)) {
      const flow = flows.get(name) ?? { name, from: [], to: [] };
      (sign > 0 ? flow.to : flow.from).push(stock);
      flows.set(name, flow);
    }
  }
  return [...flows.values()];
}

function integTerms(raw: string): { name: string; sign: number }[] {
  const body = raw.replace(/\\\n\s*/g, " ").split("~")[0].split(/INTEG\s*\(/)[1];
  const firstArg = takeFirstArgument(body).replace(/\[[^\]]*\]/g, "").replace(/\bSUM\s*\(/g, "(");
  const tokens = firstArg.match(/[+\-()]|[^+\-()]+/g) ?? [];
  const terms: { name: string; sign: number }[] = [];
  const signStack = [1];
  let pendingSign = 1;
  for (const token of tokens) {
    if (token === "+") pendingSign = 1;
    else if (token === "-") pendingSign = -1;
    else if (token === "(") {
      signStack.push(signStack.at(-1)! * pendingSign);
      pendingSign = 1;
    } else if (token === ")") signStack.pop();
    else if (token.trim()) {
      terms.push({ name: token.trim().replace(/\s+/g, " "), sign: signStack.at(-1)! * pendingSign });
      pendingSign = 1;
    }
  }
  return terms;
}

function takeFirstArgument(body: string): string {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "(") depth++;
    if (body[i] === ")") depth--;
    if (body[i] === "," && depth === 0) return body.slice(0, i);
  }
  return body;
}

function stocks(equations: Map<string, Equation[]>): [string, Equation[]][] {
  return [...equations].filter(([, eqs]) => eqs.some((e) => e.isStock));
}

function stockCount(model: Model): number {
  return stocks(model.equations).length;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Scenarios

function readScenarios(): Scenario[] {
  return readdirSync(join(REPO_DIR, SCENARIO_DIR))
    .filter((f) => f.endsWith(".cin"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => {
      const overrides = readFileSync(join(REPO_DIR, SCENARIO_DIR, f), "utf-8")
        .split(/\r?\n/)
        .filter((line) => line.includes("="))
        .map((line) => line.split("=").map((s) => s.trim()) as [string, string]);
      return {
        name: f.replace(/\.cin$/, ""),
        file: `${SCENARIO_DIR}/${f}`,
        overrides,
        isPolicy: overrides.some(([k]) => k.startsWith("Policy change")),
      };
    });
}

// ---------------------------------------------------------------------------
// Part files: the equations of each view, as plain text

function writeParts(model: Model) {
  rmSync(PARTS_DIR, { recursive: true, force: true });
  mkdirSync(PARTS_DIR, { recursive: true });
  for (const view of model.views) {
    const blocks = view.variableKeys.flatMap((key) => model.equations.get(key) ?? []);
    const header = [
      `SOURCE model, view "${view.name}"`,
      `Extracted from ${MODEL_PATH}. ${blocks.length} equations.`,
      `Variables can appear in several views; the .mdl file is the source of truth.`,
      "=".repeat(78),
    ].join("\n");
    writeFileSync(join(ROOT_DIR, view.file), `${header}\n\n${blocks.map((b) => b.raw.trim()).join("\n\n")}\n`);
  }
  writeFileSync(join(PARTS_DIR, "changelog.txt"), model.changelog.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Page

const STOCK_LAYOUT: Record<string, { col: number; row: number; label: string }> = {
  "Rx misuse no PY heroin": { col: 0, row: 0, label: "Misusing prescription opioids" },
  "Rx OUD no PY heroin no MOUD": { col: 1, row: 0, label: "Rx addiction, untreated" },
  "Rx OUD no heroin by MOUD": { col: 2, row: 0, label: "Rx addiction, in treatment" },
  "Rx OUD no heroin in remission": { col: 3, row: 0, label: "Rx addiction, in remission" },
  "Rx OUD no heroin in stable remission": { col: 4, row: 0, label: "Rx addiction, stable remission" },
  "Rx OUD with PY heroin no MOUD": { col: 1, row: 1, label: "Rx addiction + heroin, untreated" },
  "Rx OUD with heroin by MOUD": { col: 2, row: 1, label: "Rx addiction + heroin, in treatment" },
  "Rx OUD with heroin in remission": { col: 3, row: 1, label: "Rx addiction + heroin, remission" },
  "Rx OUD with heroin in stable remission": { col: 4, row: 1, label: "Rx addiction + heroin, stable" },
  "Nondisordered heroin use": { col: 0, row: 2, label: "Using heroin, not addicted" },
  "HUD no MOUD": { col: 1, row: 2, label: "Heroin addiction, untreated" },
  "HUD by MOUD": { col: 2, row: 2, label: "Heroin addiction, in treatment" },
  "HUD in remission": { col: 3, row: 2, label: "Heroin addiction, remission" },
  "HUD in stable remission": { col: 4, row: 2, label: "Heroin addiction, stable" },
};

const VIEW_DESCRIPTIONS: Record<string, string> = {
  Dashboard: "Summary panel of key outputs used when running the model interactively.",
  "Output Variables": "Derived outcomes: totals of people using, with use disorder, in treatment, and overdose deaths.",
  "Data variables": "Historical time series (1999–2020) read in from the data files, used for calibration and as inputs.",
  Calibration: "How simulated values are compared with data during estimation: errors, weights, and priors.",
  "User stocks & flows":
    "The core of the model: the 14 population stocks people move between (diagram above), plus all the transition rates.",
  "Opioid Prescribing and Supply":
    "How many patients get opioid prescriptions, for how long, and at what dose; this sets the legal opioid supply.",
  "Rx street market availability and price":
    "Diversion of prescription opioids to the street market, and how availability and price respond to supply and demand.",
  Treatment:
    "Medication treatment for addiction (buprenorphine, methadone, naltrexone): capacity limits, who enters, and who leaves.",
  "Naloxone and ODs":
    "Overdose risk for each group, the rising effect of fentanyl, and lives saved by naloxone kits.",
  "Rx and Heroin availability feedback": "Feedback loop: availability of prescription opioids and heroin affects how many people start.",
  "Social influence feedback":
    "Reinforcing loop: the more people use a drug, the more others start (and the faster addiction develops).",
  "Perceived risk feedback":
    "Balancing loop: overdose deaths make a drug seem riskier, so fewer people start. This is what eventually bends the curve.",
  "Policy and Projection drivers":
    "Inputs for the future (2021–2032): projection curves for each external driver and the policy levers scenarios can change.",
};

const SCENARIO_DESCRIPTIONS: Record<string, string> = {
  Base: "Exogenous trends continue (the paper's main projection).",
  Pos: "Optimistic: less fentanyl, more naloxone and treatment, less prescribing.",
  Neg: "Pessimistic: the reverse of optimistic.",
  Cnst: "External inputs held constant at their latest values.",
  FentH: "High fentanyl penetration.",
  FentL: "Low fentanyl penetration.",
  FentMax: "Sensitivity test: fentanyl's maximum effect on overdose risk set to 7×.",
  NoFentHist: "Counterfactual: illicit fentanyl never arrived.",
  Data2019: "Estimate using data only up to 2019.",
  None: "Projection with no policy change (reference for policy runs).",
};

function renderPage(model: Model, scenarios: Scenario[]): string {
  const coreView = model.views.find((v) => v.name === "User stocks & flows")!;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SOURCE: the FDA opioid crisis model, explained</title>
<style>${STYLES}</style>
</head>
<body>
<main>
${renderIntro(model)}
${renderDiagram(model, coreView)}
${renderStockTable(model, coreView)}
${renderViews(model)}
${renderScenarios(scenarios)}
${renderFiles()}
${renderChangelog(model)}
<footer>Generated by <a href="explorer/build.ts">explorer/build.ts</a> from
<a href="${href(MODEL_PATH)}">${esc(MODEL_PATH)}</a>. Re-run with <code>node opioid-source-model/explorer/build.ts</code>.</footer>
</main>
</body>
</html>
`;
}

function renderIntro(model: Model): string {
  return `<header>
<p class="eyebrow">Lim et al., PNAS 2022 · <a href="lim-2022-source.pdf">paper (PDF)</a> · <a href="https://github.com/FDA/SOURCE">github.com/FDA/SOURCE</a></p>
<h1>SOURCE: a model of the US opioid crisis</h1>
<p class="lede">The FDA needed to know how the opioid crisis would evolve and how policies would play out,
given long delays and feedback loops between policy and behaviour. SOURCE tracks the US population aged 12+
as people move between misusing prescription opioids, using heroin and fentanyl, addiction, treatment,
remission, and overdose death, from 1999 to 2032.</p>
<div class="stats">
  <div><b>${Object.keys(STOCK_LAYOUT).length}</b><span>population stocks</span></div>
  <div><b>${model.equations.size}</b><span>variables</span></div>
  <div><b>${model.views.length}</b><span>diagram views</span></div>
  <div><b>1999–2032</b><span>simulated years</span></div>
</div>
<div class="answers">
  <h2>What the model answered</h2>
  <ul>
    <li>Naloxone handed out to laypeople averted about <b>19,800 deaths</b> (1999–2020).</li>
    <li>Without illicit fentanyl there would have been about <b>59,000 fewer deaths</b>, much less than the 228,000
    fentanyl-involved deaths recorded, because fentanyl deaths also scared people away from starting heroin.</li>
    <li>Deaths are projected to <b>peak and then decline</b>, with 543,000–842,000 total deaths in 2020–2032 depending on the scenario.</li>
  </ul>
</div>
</header>`;
}

function renderDiagram(model: Model, coreView: View): string {
  const box = { w: 172, h: 58 };
  const origin = { x: 200, y: 100 };
  const gap = { x: 260, y: 175 };
  const width = origin.x + 4 * gap.x + box.w + 30;
  const height = origin.y + 2 * gap.y + box.h + 110;
  const position = (stock: string) => {
    const { col, row } = STOCK_LAYOUT[stock];
    return { x: origin.x + col * gap.x, y: origin.y + row * gap.y };
  };
  const source = { x: 20, y: origin.y + gap.y - box.h / 2 + 30 };

  const columnHeaders = ["Using, not addicted", "Addicted, untreated", "In medication treatment", "Remission", "Stable remission"]
    .map((t, i) => `<text class="colhead" x="${origin.x + i * gap.x + box.w / 2}" y="30">${t}</text>`)
    .join("");

  const internal = model.flows.filter((f) => f.from.concat(f.to).every((s) => s in STOCK_LAYOUT));
  const pairs = new Set(internal.map((f) => `${f.from[0]}→${f.to[0]}`));
  const arrows = internal
    .filter((f) => f.from.length === 1 && f.to.length === 1)
    .map((f) => {
      const a = position(f.from[0]);
      const b = position(f.to[0]);
      const twoWay = pairs.has(`${f.to[0]}→${f.from[0]}`);
      return arrow(f, a, b, box, twoWay);
    })
    .join("");

  const sourceArrows = model.flows
    .filter((f) => f.from.length === 0 && f.to.length === 1 && f.to[0] in STOCK_LAYOUT && /^Initiating/.test(f.name))
    .map((f, i) => {
      const b = position(f.to[0]);
      const y1 = source.y + 18 + i * 10;
      return `<path class="flow" d="M${source.x + 120},${y1} L${b.x - 4},${b.y + box.h / 2 + (i % 2) * 8 - 4}" marker-end="url(#arrow)"><title>${esc(f.name)}</title></path>`;
    })
    .join("");

  const boxes = Object.entries(STOCK_LAYOUT)
    .map(([stock, { label }]) => {
      const { x, y } = position(stock);
      const subscripted = stock.endsWith("by MOUD");
      return `<a href="${coreView.file}"><g class="stock">
<title>${esc(stock)}${subscripted ? " [×3 treatment types]" : ""}</title>
<rect x="${x}" y="${y}" width="${box.w}" height="${box.h}" rx="6"/>
${wrapText(label, x + box.w / 2, y + box.h / 2, 22)}
${subscripted ? `<text class="badge" x="${x + box.w - 8}" y="${y + 14}">×3</text>` : ""}
</g></a>`;
    })
    .join("");

  return `<section>
<h2>The core structure: who is where</h2>
<p>Each box is a <b>stock</b> (a number of people); each arrow is a <b>flow</b> (people per year moving between stocks).
This diagram is generated from the <code>INTEG</code> equations in the model file. Hover for the model's own names; click a box to open
<a href="${coreView.file}">the equations</a>. Treatment stocks are split three ways by medication (buprenorphine, methadone, naltrexone).</p>
<div class="diagram">
<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Stock and flow diagram">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
${columnHeaders}
<g class="source"><rect x="${source.x}" y="${source.y}" width="120" height="60" rx="30"/><text x="${source.x + 60}" y="${source.y + 35}">New users</text></g>
${sourceArrows}
${arrows}
${boxes}
<text class="note" x="${origin.x}" y="${height - 20}">Not drawn: every box also has outflows to overdose death and other death, and the "using, not addicted" boxes have outflows for quitting.</text>
</svg>
</div>
</section>`;
}

function arrow(
  flow: Flow,
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: { w: number; h: number },
  twoWay: boolean,
): string {
  const offset = twoWay ? 9 : 0;
  const label = flowLabel(flow.name);
  let d: string;
  let lx: number;
  let ly: number;
  if (a.y === b.y && b.x > a.x && b.x - a.x < 400) {
    const y = a.y + box.h / 2 - offset;
    d = `M${a.x + box.w},${y} L${b.x - 2},${y}`;
    [lx, ly] = [(a.x + box.w + b.x) / 2, y - 6];
  } else if (a.y === b.y && b.x > a.x) {
    const peak = a.y - 34;
    d = `M${a.x + box.w / 2},${a.y} C${a.x + box.w / 2},${peak} ${b.x + box.w / 2},${peak} ${b.x + box.w / 2},${a.y - 2}`;
    [lx, ly] = [(a.x + b.x + box.w) / 2, peak + 4];
  } else if (a.y === b.y) {
    const span = Math.round((a.x - b.x) / 260);
    const depth = a.y + box.h + 18 + span * 16;
    const endX = b.x + box.w / 2 + 14 * span;
    d = `M${a.x + box.w / 2 - 20},${a.y + box.h} C${a.x + box.w / 2 - 20},${depth} ${endX},${depth} ${endX},${b.y + box.h + 2}`;
    [lx, ly] = [(a.x + b.x + box.w) / 2, depth - 4];
  } else {
    const x = a.x + box.w / 2 + (b.y > a.y ? -offset * 2 : offset * 2);
    const down = b.y > a.y;
    d = `M${x},${down ? a.y + box.h : a.y} L${x},${down ? b.y - 2 : b.y + box.h + 2}`;
    [lx, ly] = [x + (down ? -6 : 6), (a.y + b.y + box.h) / 2];
    return `<path class="flow" d="${d}" marker-end="url(#arrow)"><title>${esc(flow.name)}</title></path>
<text class="flowlabel ${down ? "left" : "right"}" x="${lx}" y="${ly}">${esc(label)}</text>`;
  }
  return `<path class="flow" d="${d}" marker-end="url(#arrow)"><title>${esc(flow.name)}</title></path>
<text class="flowlabel" x="${lx}" y="${ly}">${esc(label)}</text>`;
}

function flowLabel(name: string): string {
  const rules: [RegExp, string][] = [
    [/^Initiating heroin/, "start heroin"],
    [/^Net quitting heroin/, "stop heroin"],
    [/^Developing/, "addiction"],
    [/^Tx engagement/, "treatment"],
    [/^Tx exit with UD/, "drop out"],
    [/^Tx exit in remission/, "recover"],
    [/^Remitting/, "recover untreated"],
    [/^Relapsing/, "relapse"],
    [/^Stabilizing/, "stabilise"],
  ];
  return rules.find(([re]) => re.test(name))?.[1] ?? name;
}

function wrapText(text: string, cx: number, cy: number, maxChars: number): string {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines.at(-1);
    if (last && (last + " " + word).length <= maxChars) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  const top = cy - ((lines.length - 1) * 15) / 2 + 5;
  return lines.map((l, i) => `<text x="${cx}" y="${top + i * 15}">${esc(l)}</text>`).join("");
}

function renderStockTable(model: Model, coreView: View): string {
  const rows = Object.entries(STOCK_LAYOUT)
    .map(([stock, { label }]) => {
      const inflows = model.flows.filter((f) => f.to.includes(stock)).map((f) => f.name);
      const outflows = model.flows.filter((f) => f.from.includes(stock)).map((f) => f.name);
      return `<tr><td><b>${esc(label)}</b><br><code>${esc(stock)}</code></td>
<td>${inflows.map(esc).join("<br>")}</td><td>${outflows.map(esc).join("<br>")}</td></tr>`;
    })
    .join("");
  const accounting = stocks(model.equations)
    .map(([, eqs]) => eqs[0].name)
    .filter((name) => !(name in STOCK_LAYOUT));
  return `<section>
<details>
<summary>All flows in and out of each stock (model names)</summary>
<table class="flows"><thead><tr><th>Stock</th><th>Inflows</th><th>Outflows</th></tr></thead><tbody>${rows}</tbody></table>
<p>The model has ${accounting.length} more stocks that only accumulate totals for reporting:
${accounting.map((n) => `<code>${esc(n)}</code>`).join(", ")}.
All are defined in <a href="${coreView.file}">${esc(coreView.name)}</a> or the output views.</p>
</details>
</section>`;
}

function renderViews(model: Model): string {
  const card = (view: View) => {
    const count = view.variableKeys.filter((k) => model.equations.has(k)).length;
    return `<a class="card" href="${view.file}"><h3>${esc(view.name)}</h3>
<p>${esc(VIEW_DESCRIPTIONS[view.name] ?? "")}</p><span class="meta">${count} variables · ${view.slug}.txt</span></a>`;
  };
  const groups: [string, string, string[]][] = [
    ["Core population model", "Where people are and how they move.", ["User stocks & flows"]],
    [
      "Feedback loops",
      "What makes the model dynamic: transition rates respond to the state of the crisis instead of being fixed.",
      ["Social influence feedback", "Perceived risk feedback", "Rx and Heroin availability feedback"],
    ],
    [
      "Sectors that drive the rates",
      "Supply, treatment, and overdose mechanics that feed into the core flows.",
      ["Opioid Prescribing and Supply", "Rx street market availability and price", "Treatment", "Naloxone and ODs"],
    ],
    [
      "Running, fitting, and projecting",
      "Data in, outputs out, calibration against history, and levers for future scenarios.",
      ["Data variables", "Calibration", "Policy and Projection drivers", "Output Variables", "Dashboard"],
    ],
  ];
  const sections = groups
    .map(([title, intro, names]) => {
      const views = names.map((n) => model.views.find((v) => v.name === n)).filter((v): v is View => !!v);
      return `<h3 class="group">${esc(title)}</h3><p>${esc(intro)}</p><div class="cards">${views.map(card).join("")}</div>`;
    })
    .join("");
  return `<section>
<h2>The parts of the model</h2>
<p>The model file is organised into ${model.views.length} diagram views. Each link below opens a plain-text file with
the equations of every variable shown in that view, extracted from the model file.</p>
${sections}
</section>`;
}

function renderScenarios(scenarios: Scenario[]): string {
  const row = (s: Scenario) => `<tr><td><a href="${href(s.file)}">${esc(s.name)}</a></td>
<td>${esc(SCENARIO_DESCRIPTIONS[s.name] ?? "")}</td>
<td>${s.overrides.map(([k, v]) => `<code>${esc(k)} = ${esc(v)}</code>`).join("<br>")}</td></tr>`;
  const table = (list: Scenario[]) =>
    `<table class="scenarios"><thead><tr><th>File</th><th>Meaning</th><th>Overrides</th></tr></thead><tbody>${list.map(row).join("")}</tbody></table>`;
  return `<section>
<h2>Scenarios</h2>
<p>A scenario is a small <code>.cin</code> file that overrides a few constants in the base model. That is how the paper's
optimistic and pessimistic futures, the "no fentanyl" counterfactual, and policy tests are defined.</p>
<h3 class="group">Projections and counterfactuals</h3>
${table(scenarios.filter((s) => !s.isPolicy))}
<details><summary>Policy scenarios (${scenarios.filter((s) => s.isPolicy).length} files, from the follow-up Science Advances paper)</summary>
<p>Each policy changes one lever by a percentage from 2022, ramping up over 3 years. Files ending in 10 or 50 are the same policy at 10% or 50% strength instead of the default 20%.</p>
${table(scenarios.filter((s) => s.isPolicy))}
</details>
</section>`;
}

function renderFiles(): string {
  const groups: [string, [string, string][]][] = [
    [
      "Model",
      [
        [MODEL_PATH, "The complete model as Vensim text: every equation, unit, comment, and diagram layout."],
        ["Vensim Files/OSM_Master.vgd", "Saved graph definitions for viewing results in Vensim."],
        ["Vensim Files/inputtimeseries.vdf", "Historical input data (prescribing, fentanyl, naloxone, treatment capacity…)."],
        ["Vensim Files/validationtimeseries.vdf", "Historical data the model is fitted to."],
        ["Vensim Files/monthlytimeseries.vdf", "Monthly input data."],
        ["Vensim Files/yearsubs.vdf", "Year lookup data."],
      ],
    ],
    [
      "Calibration setup",
      [
        ["Vensim Files/OIC0203.vpd", "Payoff definition: which outputs are compared with which data."],
        ["Vensim Files/OIC220127.voc", "Optimisation control: which parameters are estimated and their ranges."],
        ["Vensim Files/CalWts220120.cin", "Calibration weights."],
        ["Vensim Files/ProjEndVals.cin", "End values for projection curves."],
        ["Vensim Files/OIC_sens.lst", "Save list for estimation runs."],
        ["Vensim Files/Pol_sens.lst", "Save list for policy runs."],
      ],
    ],
    [
      "Documentation and data",
      [
        ["Data/Equations Listing 220203.xlsx", "Spreadsheet listing of all equations."],
        ["Data/Documentation Master File Final.xlsx", "Parameter sources, data derivations, and assumptions."],
        ["Data/Combined Modeling Files.xlsx", "Combined input data used to build the data files."],
        ["Data/R Code for NSDUH/NSDUH_multiyear02_19_cleaned.R", "R code that processes the national drug use survey."],
      ],
    ],
    [
      "Independent review (commissioned by the FDA)",
      [
        ["Model Documentation & Review Reports/Review Reports/D6b_Final Validation Part 1_Report.docx", "Validation review, part 1."],
        ["Model Documentation & Review Reports/Review Reports/D6b_Final Validation Part 2_Report.docx", "Validation review, part 2."],
        ["Model Documentation & Review Reports/Review Reports/D6b_Final Validation Part 1_Findings_v2.xlsx", "Reviewers' findings list."],
      ],
    ],
    [
      "Analysis code",
      [
        ["Analysis & Graphing/OIC-OO v7.ipynb", "Estimation pipeline (maximum likelihood + MCMC)."],
        ["Analysis & Graphing/OSM Results Processing.ipynb", "Post-processing of results."],
        ["Analysis & Graphing/OSM Graphing - Main Paper v3.ipynb", "Figures for the paper."],
        ["Analysis & Graphing/README.md", "How to run the pipeline."],
      ],
    ],
  ];
  const lists = groups
    .map(
      ([title, files]) =>
        `<h3 class="group">${esc(title)}</h3><ul class="files">${files
          .map(([path, note]) => `<li><a href="${href(path)}">${esc(path.split("/").at(-1)!)}</a> ${esc(note)}</li>`)
          .join("")}</ul>`,
    )
    .join("");
  return `<section>
<h2>Fit to history and projections</h2>
<figure><img src="${href("Publication Figures & Results Summary/Figures/X8_fits_main_horizontal.svg")}" alt="Model fit to historical data">
<figcaption>Simulated (blue) against historical data (grey), 1999–2020.</figcaption></figure>
<figure><img src="${href("Publication Figures & Results Summary/Figures/X8_fits_proj_horizontal.svg")}" alt="Projections under three scenarios">
<figcaption>Projections to 2032 under the base, optimistic, and pessimistic scenarios.</figcaption></figure>
</section>
<section>
<h2>Other files</h2>
<p>The same model file is copied, byte for byte, into <code>Analysis &amp; Graphing/X8_IterCal/</code> and
<code>Model &amp; Analysis Replication Package/</code>.</p>
${lists}
</section>`;
}

function renderChangelog(model: Model): string {
  return `<section>
<h2>Change log kept inside the model</h2>
<p>The modellers kept a hand-written change log as text boxes in a diagram view (<a href="explorer/parts/changelog.txt">changelog.txt</a>).
It is the only version history the model itself carries.</p>
<ol class="changelog">${model.changelog
    .map((entry) => {
      const [date, ...text] = entry.split(" - ");
      return `<li><time>20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}</time> ${esc(text.join(" - "))}</li>`;
    })
    .join("")}</ol>
</section>`;
}

function href(repoPath: string): string {
  return ["source-model", ...repoPath.split("/")].map(encodeURIComponent).join("/");
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STYLES = `
:root { --ink:#1d2433; --muted:#5b6475; --line:#d9dee7; --accent:#2f5bd3; --stock:#eef3ff; --bg:#fafbfc; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 1240px; margin: 0 auto; padding: 40px 28px 80px; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
h1 { font-size: 2.2rem; margin: 4px 0 12px; } h2 { margin: 0 0 10px; font-size: 1.45rem; }
h3.group { margin: 26px 0 4px; font-size: 1.05rem; }
section { margin-top: 44px; }
.eyebrow { color: var(--muted); font-size: .9rem; margin: 0; }
.lede { font-size: 1.1rem; max-width: 820px; }
.stats { display:flex; gap:14px; flex-wrap:wrap; margin: 22px 0; }
.stats div { background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px 18px; min-width:150px; }
.stats b { display:block; font-size:1.5rem; } .stats span { color:var(--muted); font-size:.9rem; }
.answers { background:#fff; border:1px solid var(--line); border-left:4px solid var(--accent); border-radius:8px; padding:16px 22px; max-width: 900px; }
.answers h2 { font-size: 1.1rem; } .answers ul { margin: 0; padding-left: 20px; }
.diagram { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px; overflow-x:auto; }
svg { width:100%; min-width: 1000px; height:auto; font-size:14px; }
svg .colhead { text-anchor:middle; font-weight:600; fill:var(--muted); font-size:13px; }
svg .stock rect { fill:var(--stock); stroke:var(--accent); stroke-width:1.5; }
svg .stock:hover rect { fill:#dbe6ff; } svg .stock text { text-anchor:middle; fill:var(--ink); }
svg .stock .badge { text-anchor:end; font-size:11px; fill:var(--accent); font-weight:700; }
svg .source rect { fill:#f3f4f6; stroke:#9aa3b2; stroke-dasharray:4 3; } svg .source text { text-anchor:middle; fill:var(--muted); }
svg .flow { fill:none; stroke:#7b8494; stroke-width:1.6; } svg .flow:hover { stroke:var(--accent); stroke-width:2.5; }
svg marker path { fill:#7b8494; }
svg .flowlabel { font-size:11px; fill:var(--muted); text-anchor:middle; paint-order:stroke; stroke:#fff; stroke-width:4px; }
svg .flowlabel.left { text-anchor:end; } svg .flowlabel.right { text-anchor:start; }
svg .note { font-size:12px; fill:var(--muted); }
.cards { display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:14px; margin-top:10px; }
.card { display:block; background:#fff; border:1px solid var(--line); border-radius:10px; padding:14px 16px; color:var(--ink); }
.card:hover { border-color:var(--accent); text-decoration:none; box-shadow:0 2px 10px rgba(47,91,211,.08); }
.card h3 { margin:0 0 6px; font-size:1rem; color:var(--accent); } .card p { margin:0 0 10px; font-size:.92rem; }
.card .meta { font-size:.8rem; color:var(--muted); }
table { border-collapse:collapse; width:100%; background:#fff; font-size:.88rem; margin-top:10px; }
th, td { text-align:left; vertical-align:top; border-bottom:1px solid var(--line); padding:8px 10px; }
th { background:#f3f5f9; } code { font-size:.85em; }
details { margin-top: 14px; } summary { cursor:pointer; font-weight:600; color:var(--accent); }
ul.files { padding-left:20px; margin:6px 0; } ul.files li { margin:3px 0; color:var(--muted); } ul.files a { margin-right:6px; }
figure { margin: 18px 0; background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px; }
figure img { width:100%; height:auto; } figcaption { color:var(--muted); font-size:.9rem; margin-top:6px; }
ol.changelog { padding-left: 0; list-style:none; } ol.changelog li { margin:8px 0; padding-left: 110px; position:relative; }
ol.changelog time { position:absolute; left:0; color:var(--muted); font-variant-numeric: tabular-nums; }
footer { margin-top:60px; color:var(--muted); font-size:.85rem; }
`;

main();
