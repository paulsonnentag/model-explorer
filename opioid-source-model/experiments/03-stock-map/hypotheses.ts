// Explanations and findings from the two SOURCE papers, each with the model's charts that bear on it,
// the historical data where there is some, and alternative runs: the same history without fentanyl,
// another future, or one of the authors' own policy files. No alternative removes a part of the fitted
// model; these show how the model produces its behaviour and what it projects, they do not test it.
// Every alternative is drawn in the charts at once; choosing one runs the whole map in that state, with
// the first alternative as the dashed comparison.

import type { RunResult } from "../core/compile.ts";
import { type Points, chart, formatNumber } from "../shared/chart.ts";
import { escapeHtml } from "../shared/html.ts";
import type { WhatIf } from "../shared/runs.ts";
import { totalSeries } from "../shared/totals.ts";
import { type MapApp, bindHover } from "./context.ts";

export type Alternative = { id: string; label: string; note: string; future?: string; noFentanyl?: boolean; lever?: string; strength?: WhatIf["strength"] };

// A chart sums `keys` from `from` on. `relative` plots each alternative as a percentage change against
// the first, the form of the papers' policy figures; otherwise historical series in `data` (summed) are
// drawn as dots. `hover` is what the title lights up on the map.
type Chart = { label: string; keys: string[]; hover: string; data?: string[]; relative?: boolean; from?: number };

// `delta` adds each alternative's difference from the first, in people or in percent.
type Metric = { label: string; value: (app: MapApp, run: RunResult, base: RunResult) => number; format: (v: number) => string; delta?: "abs" | "pct" };

export type Hypothesis = {
  id: string;
  title: string;
  claim: string;
  quote: string;
  source: string;
  paper: string;
  // Where the model here and the paper's number part ways, or what else the authors found.
  caveat?: string;
  loops: string[];
  charts: Chart[];
  metrics: Metric[];
  alternatives: Alternative[];
};

const RISK = "pr:perceived risk heroin use relative";
const PEER_RECOVERY = "si:si on remission relative";
const HEROIN_STARTS = ["initiating heroin with rx misuse", "initiating heroin with rx oud", "initiating heroin no rx"];
const HEROIN_DEATHS = "total overdose deaths heroin";
const ALL_DEATHS = "total overdose deaths";
const ON_MEDICATION = "stock:hud by moud|rx oud no heroin by moud|rx oud with heroin by moud";
const DATA_ENDS = 2020.5;
const POLICY_STARTS = 2020;
const ALT_COLORS = ["#1f2328", "#e11d48", "#2563eb", "#d97706"];
const DATA_COLOR = "#6b7280";
const NO_POLICY: Alternative = { id: "none", label: "No policy", note: "Trends continue, no policy change." };

export const HYPOTHESES: Hypothesis[] = [
  {
    id: "fentanyl",
    title: "Fentanyl's toll is smaller than the raw counts, because it scared people off heroin",
    claim: "Without fentanyl fewer people would have died, but more would have started heroin: the deaths fentanyl caused raised the perceived risk of heroin and held use down.",
    quote: "The fentanyl surge caused a rapid increase in the perceived risk associated with heroin use, which led to less heroin use by 2020 than there would have been otherwise.",
    source: "Lim et al. 2022 (PNAS), Competing Influences of Naloxone and Fentanyl; Fig. 4",
    paper: "59,000 fewer deaths 1999–2020 without fentanyl (90% credible interval 55,000–65,000), against ~228,000 deaths involving synthetic opioids in the raw counts.",
    caveat:
      "Here the gap is about 130,000 by 2020 (91,000 by 2019), and Vensim's own published runs of this model agree, so it is not our engine. The authors' results summary lists 476,507 deaths 'without fentanyl' by 2019, which is what the run with fentanyl reaches by 2019 (476,508 here), and 535,337 − 476,507 = 58,830, the paper's 59,000. The paper's figure may compare the fitted run at two dates; we have not been able to confirm this. The direction holds either way: fewer deaths, more people starting heroin.",
    loops: [RISK],
    charts: [
      { label: "Opioid overdose deaths", keys: [ALL_DEATHS], data: ["total overdose deaths nvss"], hover: `var:${ALL_DEATHS}` },
      { label: "People starting heroin", keys: HEROIN_STARTS, data: ["total heroin initiation data"], hover: `flow:${HEROIN_STARTS.join("|")}` },
      { label: "Perceived risk of heroin (1999 = 1)", keys: ["perceived risk heroin use relative"], hover: `loop:${RISK}` },
    ],
    metrics: [
      { label: "Deaths 1999–2020", value: (app, run) => app.runs.valueAt(run, "cumulative overdose deaths", 2020), format: formatNumber, delta: "abs" },
      { label: "Heroin starts 1999–2020", value: (app, run) => integral(app, run, HEROIN_STARTS, 2021), format: formatNumber, delta: "abs" },
    ],
    alternatives: [
      { id: "fitted", label: "As fitted", note: "Actual history, the model as calibrated." },
      { id: "no-fentanyl", label: "Without fentanyl", note: "The same history if illicit fentanyl had never entered the heroin supply.", noFentanyl: true },
    ],
  },
  {
    id: "peak",
    title: "Deaths peak and then fall in every future",
    claim: "Heroin and fentanyl deaths keep rising for a few years and then decline under optimistic, middle and pessimistic assumptions alike, which the authors attribute mainly to the risk response cutting the number of people who start.",
    quote: "In all three scenarios, the trend eventually reverses and deaths start to decline as the prevalence of heroin/IMF use falls. Projections from other models … may miss the impending peak and decline.",
    source: "Lim et al. 2022 (PNAS), Policy Analysis Process and Baseline Projections; Fig. 5",
    paper: "543,000 to 842,000 deaths in 2020–2032 in the optimistic and pessimistic scenarios.",
    caveat:
      "The authors also tested the risk response directly (X8_lk_sens.tab in their results). Re-fitted without it, the model matches history worse (average error 15.9% against 12.7%) and projects 16% more deaths for 2020–2032. Switching it off in the fitted model without re-fitting gives +294% and an average error of 197%, which is why this page does not offer that switch.",
    loops: [RISK],
    charts: [
      { label: "Overdose deaths from heroin and fentanyl", keys: [HEROIN_DEATHS], hover: `var:${HEROIN_DEATHS}` },
      { label: "Addicted to heroin", keys: ["hud total"], data: ["hud data"], hover: "stock:hud no moud|hud by moud" },
      { label: "People starting heroin", keys: HEROIN_STARTS, data: ["total heroin initiation data"], hover: `flow:${HEROIN_STARTS.join("|")}` },
    ],
    metrics: [
      { label: "Heroin deaths peak", value: (app, run) => peak(app, run, [HEROIN_DEATHS]), format: (v) => String(Math.floor(v)) },
      { label: "Deaths 2020–2032", value: (app, run) => app.runs.valueAt(run, "projected cumulative overdose deaths", Infinity), format: formatNumber, delta: "abs" },
    ],
    alternatives: [
      { id: "base", label: "Trends continue", note: "Inputs keep their recent trends, slowing to 2032." },
      { id: "optimistic", label: "Optimistic", note: "Less fentanyl, more naloxone and treatment, fewer prescriptions.", future: "Pos" },
      { id: "pessimistic", label: "Pessimistic", note: "More fentanyl, less naloxone and treatment, prescribing cuts weaken.", future: "Neg" },
    ],
  },
  {
    id: "buprenorphine",
    title: "More buprenorphine prescribers do nothing; letting each treat more patients helps, but only briefly",
    claim: "Capacity limits treatment only while demand outgrows it. As heroin addiction falls, demand eases, so raising each prescriber's capacity saves lives in the first years and then stops mattering, and adding prescribers never matters.",
    quote:
      "Increasing the number of buprenorphine providers does not reduce overdose deaths in the near or long term. Growing buprenorphine providers' capacity to treat more people, on the other hand, has among the largest effects on opioid overdose deaths in the near term, reaching a peak annual reduction of approximately 2% by mid-2023 before falling quickly to having no impact relative to baseline.",
    source: "Stringfellow et al. 2022 (Science Advances), Effects of strategies on annual opioid overdose deaths; Fig. 1B",
    paper: "More prescribers: no effect. More patients per prescriber (20%): about 2% fewer deaths at the peak in mid-2023, then none.",
    loops: [],
    charts: [
      { label: "Overdose deaths, change against no policy (%)", keys: [ALL_DEATHS], hover: `var:${ALL_DEATHS}`, relative: true, from: POLICY_STARTS },
      { label: "People on addiction medication", keys: ["total by moud"], hover: ON_MEDICATION, from: 2015 },
      { label: "People with addiction, change against no policy (%)", keys: ["total with ud"], hover: "var:total with ud", relative: true, from: POLICY_STARTS },
    ],
    metrics: [
      { label: "Largest cut in deaths", value: (app, run, base) => largestCut(app, run, base, [ALL_DEATHS]), format: percent },
      { label: "Deaths 2020–2032", value: (app, run) => app.runs.valueAt(run, "projected cumulative overdose deaths", Infinity), format: formatNumber, delta: "pct" },
    ],
    alternatives: [
      NO_POLICY,
      { id: "providers", label: "20% more prescribers", note: "More providers who may legally prescribe buprenorphine (waivers).", lever: "BupProv" },
      { id: "capacity", label: "20% more patients per prescriber", note: "Existing providers can each treat more patients.", lever: "BupProvBarriers" },
    ],
  },
  {
    id: "prescribing",
    title: "Prescribing fewer opioids makes heroin addiction worse before it makes it better",
    claim: "Fewer prescriptions mean fewer pills to misuse, so pill addiction falls. But some people who would have misused pills switch to heroin, so heroin addiction first rises above the no-policy run, and only falls below it once fewer people are addicted to pills and could switch.",
    quote:
      "The effect of reducing opioid prescribing on OUD involving heroin exhibits a worse-before-better dynamic. At first, it increases slightly compared to baseline because reducing prescription opioid availability leads some people to switch to heroin … However, starting around 2028, OUD involving heroin falls compared to baseline.",
    source: "Stringfellow et al. 2022 (Science Advances), Effects of strategies on annual OUD prevalence; Fig. 1A",
    paper: "People with addiction 3.7% lower by 2032 (20% fewer patients prescribed); heroin addiction above baseline at first, below it from about 2028.",
    loops: [],
    charts: [
      { label: "Addicted to heroin, change against no policy (%)", keys: ["hud total"], hover: "stock:hud no moud|hud by moud", relative: true, from: POLICY_STARTS },
      { label: "Addicted to pills, change against no policy (%)", keys: ["rx oud all total"], hover: "var:rx oud all total", relative: true, from: POLICY_STARTS },
      { label: "Patients prescribed opioids", keys: ["patients receiving opioid prescription annual"], hover: "var:patients receiving opioid prescription annual", from: 2015 },
    ],
    metrics: [
      { label: "Heroin addiction 2025", value: (app, run, base) => change(app, run, base, ["hud total"], 2025), format: percent },
      { label: "Heroin addiction 2032", value: (app, run, base) => change(app, run, base, ["hud total"], 2032), format: percent },
      { label: "All addiction 2032", value: (app, run, base) => change(app, run, base, ["total with ud"], 2032), format: percent },
    ],
    alternatives: [
      NO_POLICY,
      { id: "rx-20", label: "20% fewer patients prescribed", note: "Fewer people receive an opioid prescription.", lever: "RxRate" },
      { id: "rx-50", label: "50% fewer patients prescribed", note: "The same policy at the paper's largest effect size.", lever: "RxRate", strength: "50" },
    ],
  },
  {
    id: "recovery",
    title: "Recovery support has the most lasting effect on addiction, and the peer version feeds itself",
    claim: "Relapse after remission is becoming the main source of addiction. Keeping people in remission therefore does more than preventing new cases, and peer recovery, where more people in remission lower everyone's relapse rate, grows its own effect.",
    quote:
      "The recovery support strategies … are the most impactful in reducing OUD prevalence by 2032 (−5.2% for return to OUD and −5.4% for peer recovery) … The peer recovery loop has an even larger impact than the direct reduction in the return to OUD rate because of the loop's reinforcing nature.",
    source: "Stringfellow et al. 2022 (Science Advances), Effects of strategies on annual OUD prevalence; Fig. 1C",
    paper: "People with addiction 5.2% (fewer relapses) and 5.4% (peer recovery) lower by 2032; deaths 5.7% and 6.1% lower in 2032.",
    caveat: "Peer recovery is the one policy that adds a loop: it switches on 'People in recovery affect relapse', which the fitted model keeps at zero for policy testing.",
    loops: [PEER_RECOVERY],
    charts: [
      { label: "People with addiction, change against no policy (%)", keys: ["total with ud"], hover: "var:total with ud", relative: true, from: POLICY_STARTS },
      { label: "Overdose deaths, change against no policy (%)", keys: [ALL_DEATHS], hover: `var:${ALL_DEATHS}`, relative: true, from: POLICY_STARTS },
      { label: "People in remission", keys: ["total in remission"], hover: "var:total in remission", from: 2015 },
    ],
    metrics: [
      { label: "Addiction 2032", value: (app, run, base) => change(app, run, base, ["total with ud"], 2032), format: percent },
      { label: "Deaths in 2032", value: (app, run, base) => change(app, run, base, [ALL_DEATHS], 2032), format: percent },
    ],
    alternatives: [
      NO_POLICY,
      { id: "relapse", label: "20% fewer relapses", note: "A lower rate of returning to addiction after remission.", lever: "ReturntoOUD" },
      { id: "peer", label: "Peer recovery support", note: "More people in remission lower the relapse rate; set to a 20% cut by 2025.", lever: "PeerRecovery" },
    ],
  },
];

export function renderHypotheses(root: HTMLElement, app: MapApp) {
  const index = HYPOTHESES.findIndex((h) => h.id === app.hypothesis);
  root.innerHTML = `<div class="hyp-head">
      <h2>Findings</h2>
      <span class="cycle"><button data-hyp="prev" title="Previous (←)">‹</button><span>${index < 0 ? "–" : index + 1}/${HYPOTHESES.length}</span><button data-hyp="next" title="Next (→)">›</button></span>
    </div>
    <p class="hint">Claims from the two SOURCE papers, chosen by us. Each shows how the model produces the behaviour, against historical data where there is some (dots), with the authors' alternatives: another future, no fentanyl, or a policy from 2022. They explain the model; they do not test it. Pick a row to run the whole map in that state.</p>
    ${HYPOTHESES.map((h, i) => section(app, h, i)).join("")}`;
  if (!root.dataset.hoverBound) {
    bindHover(root, app);
    root.dataset.hoverBound = "1";
  }
  root.onclick = (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-hyp]");
    if (!target) return;
    const [kind, id, alt] = target.dataset.hyp!.split(":");
    if (kind === "prev" || kind === "next") return app.actions.cycleHypothesis(kind === "next" ? 1 : -1);
    if (kind === "open") return app.actions.selectHypothesis(app.hypothesis === id ? null : id);
    if (kind === "alt") app.actions.applyAlternative(id, alt);
  };
}

export function alternativeWhatIf(alt: Alternative): WhatIf {
  return { future: alt.future ?? "Base", noFentanyl: !!alt.noFentanyl, lever: alt.lever ?? "None", strength: alt.strength ?? "20", edits: new Map() };
}

function section(app: MapApp, h: Hypothesis, index: number): string {
  const open = app.hypothesis === h.id;
  return `<section class="hyp${open ? " open" : ""}">
    <header data-hyp="open:${h.id}"><span class="chev">${open ? "▾" : "▸"}</span><span class="num">${index + 1}</span><span class="title">${escapeHtml(h.title)}</span></header>
    ${open ? body(app, h) : ""}
  </section>`;
}

function body(app: MapApp, h: Hypothesis): string {
  const runs = h.alternatives.map((alt) => app.runs.current(alternativeWhatIf(alt)));
  const active = h.alternatives.findIndex((alt) => app.alternative === `${h.id}:${alt.id}`);
  return `<div class="hyp-body">
    <p class="claim">${escapeHtml(h.claim)}</p>
    <blockquote>${escapeHtml(h.quote)}<cite>${escapeHtml(h.source)}</cite></blockquote>
    ${h.charts.map((c) => chartBlock(app, c, h, runs, active)).join("")}
    ${alternativesTable(app, h, runs, active)}
    <p class="paper"><b>Paper:</b> ${escapeHtml(h.paper)}</p>
    ${h.caveat ? `<p class="caveat">${escapeHtml(h.caveat)}</p>` : ""}
  </div>`;
}

// One line per alternative; the active one is drawn on top and thicker. Absolute charts scale to the
// first and the active alternative, so a runaway one breaks off at the top instead of flattening the rest.
function chartBlock(app: MapApp, c: Chart, h: Hypothesis, runs: RunResult[], active: number): string {
  const times = app.current.times;
  const start = Math.max(0, times.findIndex((t) => t >= (c.from ?? times[0])));
  const raw = runs.map((run) => sum(app, run, c.keys));
  const series = c.relative ? raw.map((values) => values.map((v, i) => (raw[0][i] ? (100 * (v - raw[0][i])) / raw[0][i] : 0))) : raw;
  const shown = series.map((values) => values.slice(start));
  const limit = c.relative ? Infinity : 1.6 * Math.max(...[0, active].filter((i) => i >= 0).map((i) => Math.max(...shown[i])));
  const offScale = shown.flatMap((values, i) => (Math.max(...values) > limit ? [h.alternatives[i].label] : []));
  const order = shown.map((_, i) => i).sort((a, b) => Number(a === active) - Number(b === active));
  const lines = order.map((i) => ({
    values: shown[i].map((v) => (v > limit ? NaN : v)),
    color: ALT_COLORS[i % ALT_COLORS.length],
    width: i === active ? 2.2 : 1.2,
  }));
  const note = offScale.length ? `<span class="off-scale">${escapeHtml(offScale.join(", "))} goes off the scale</span>` : "";
  const markers = times[start] < DATA_ENDS ? [{ time: DATA_ENDS, label: "data ends" }] : [];
  return `<div class="hyp-chart"><div class="label" data-hover="${escapeHtml(c.hover)}">${escapeHtml(c.label)}</div>${note}
    ${chart({ times: times.slice(start), lines, points: c.relative ? [] : dataPoints(app, c, times[start]), markers, width: 316, height: 104 })}</div>`;
}

function alternativesTable(app: MapApp, h: Hypothesis, runs: RunResult[], active: number): string {
  const values = runs.map((run) => h.metrics.map((m) => m.value(app, run, runs[0])));
  const rows = h.alternatives.map((alt, i) => {
    const cells = h.metrics.map((m, j) => {
      const diff = values[i][j] - values[0][j];
      const delta = i === 0 || !m.delta ? "" : ` <small>${m.delta === "abs" ? signed(diff) : percent((100 * diff) / values[0][j])}</small>`;
      return `<td>${escapeHtml(m.format(values[i][j]))}${delta}</td>`;
    });
    return `<tr class="${i === active ? "active" : ""}" data-hyp="alt:${h.id}:${alt.id}" title="${escapeHtml(alt.note)}">
      <th><i style="background:${ALT_COLORS[i % ALT_COLORS.length]}"></i>${escapeHtml(alt.label)}</th>${cells.join("")}</tr>`;
  });
  return `<table class="alts"><thead><tr><th>Click a row to apply it</th>${h.metrics.map((m) => `<th>${escapeHtml(m.label)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

// The chart's historical series, summed year by year where every series has a value.
function dataPoints(app: MapApp, c: Chart, from: number): Points[] {
  if (!c.data) return [];
  const series = c.data.map((key) => app.model.dataPoints(app.sem.vars.get(key)!.cells[0])!);
  const times = series[0].times.filter((t) => t >= from && series.every((s) => s.times.includes(t)));
  const values = times.map((t) => series.reduce((total, s) => total + s.values[s.times.indexOf(t)], 0));
  return [{ times, values, color: DATA_COLOR, label: "data" }];
}

function sum(app: MapApp, run: RunResult, keys: string[]): Float64Array {
  const out = new Float64Array(run.times.length);
  for (const key of keys) totalSeries(app.model, app.sem, run, key).forEach((v, i) => (out[i] += v));
  return out;
}

function integral(app: MapApp, run: RunResult, keys: string[], before: number): number {
  const values = sum(app, run, keys);
  const dt = run.times[1] - run.times[0];
  return values.reduce((total, v, i) => (run.times[i] < before ? total + v * dt : total), 0);
}

function peak(app: MapApp, run: RunResult, keys: string[]): number {
  const values = sum(app, run, keys);
  let best = 0;
  values.forEach((v, i) => (v > values[best] ? (best = i) : 0));
  return run.times[best];
}

function change(app: MapApp, run: RunResult, base: RunResult, keys: string[], year: number): number {
  const at = (r: RunResult) => sum(app, r, keys)[Math.round((year - r.times[0]) / (r.times[1] - r.times[0]))];
  return (100 * (at(run) - at(base))) / at(base);
}

function largestCut(app: MapApp, run: RunResult, base: RunResult, keys: string[]): number {
  const ours = sum(app, run, keys);
  const theirs = sum(app, base, keys);
  return Math.min(0, ...ours.map((v, i) => (theirs[i] ? (100 * (v - theirs[i])) / theirs[i] : 0)));
}

function percent(v: number): string {
  if (Math.abs(v) < 0.05) return "0%";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v))}`;
}
