// Claims from the paper, each with the model's charts that bear on it and alternative versions of the
// model to compare against: the same history without fentanyl, with a loop switched off, or under
// another future. Every alternative is drawn in the charts at once; choosing one runs the whole map
// in that state, with the first alternative (the model as fitted) as the dashed comparison.

import type { RunResult } from "../core/compile.ts";
import { chart, formatNumber } from "../shared/chart.ts";
import { escapeHtml } from "../shared/html.ts";
import { knockoutCells } from "../shared/loops.ts";
import type { WhatIf } from "../shared/runs.ts";
import { totalSeries } from "../shared/totals.ts";
import { type MapApp, bindHover } from "./context.ts";

export type Alternative = { id: string; label: string; note: string; future?: string; noFentanyl?: boolean; loopsOff?: string[] };

// A chart sums `keys`; `hover` is what it lights up on the map.
type Chart = { label: string; keys: string[]; hover: string; unit: string };

type Metric = { label: string; value: (app: MapApp, run: RunResult) => number; format: (v: number, run: RunResult, app: MapApp) => string };

export type Hypothesis = {
  id: string;
  title: string;
  claim: string;
  quote: string;
  source: string;
  paper: string;
  loops: string[];
  charts: Chart[];
  metrics: Metric[];
  alternatives: Alternative[];
};

const RISK = "pr:perceived risk heroin use relative";
const PEERS = "si:si on initiating heroin relative";
const HEROIN_STARTS = ["initiating heroin with rx misuse", "initiating heroin with rx oud", "initiating heroin no rx"];
const STARTS_FROM_PILLS = ["initiating heroin with rx misuse", "initiating heroin with rx oud"];
const HEROIN_DEATHS = "total overdose deaths heroin";
const DATA_ENDS = 2020.5;
const ALT_COLORS = ["#1f2328", "#e11d48", "#2563eb", "#d97706"];

export const HYPOTHESES: Hypothesis[] = [
  {
    id: "fentanyl",
    title: "Fentanyl's toll is smaller than the raw counts, because it scared people off heroin",
    claim: "Without fentanyl fewer people would have died, but more would have started heroin: the deaths fentanyl caused raised the perceived risk of heroin and held use down.",
    quote: "The fentanyl surge caused a rapid increase in the perceived risk associated with heroin use, which led to less heroin use by 2020 than there would have been otherwise.",
    source: "Lim et al. 2022, Competing Influences of Naloxone and Fentanyl; Fig. 4",
    paper: "59,000 fewer deaths 1999–2020 without fentanyl, against ~228,000 deaths involving synthetic opioids in the raw counts.",
    loops: [RISK],
    charts: [
      { label: "Overdose deaths from heroin and fentanyl", keys: [HEROIN_DEATHS], hover: `var:${HEROIN_DEATHS}`, unit: "/yr" },
      { label: "People starting heroin", keys: HEROIN_STARTS, hover: `flow:${HEROIN_STARTS.join("|")}`, unit: "/yr" },
      { label: "Perceived risk of heroin (1999 = 1)", keys: ["perceived risk heroin use relative"], hover: `loop:${RISK}`, unit: "" },
    ],
    metrics: [
      { label: "Deaths 1999–2020", value: (app, run) => valueIn(app, run, "cumulative overdose deaths", 2020), format: (v) => formatNumber(v) },
      { label: "Heroin starts 1999–2020", value: (app, run) => integral(app, run, HEROIN_STARTS, 2021), format: (v) => formatNumber(v) },
    ],
    alternatives: [
      { id: "fitted", label: "As fitted", note: "Actual history, the model as calibrated." },
      { id: "no-fentanyl", label: "Without fentanyl", note: "The same history if illicit fentanyl had never entered the heroin supply.", noFentanyl: true },
    ],
  },
  {
    id: "peers-then-risk",
    title: "Heroin starts kept rising after pill misuse peaked: peers pushed them up, then risk pulled them down",
    claim: "People moving from pills to heroin kept increasing until about 2013, though pill misuse had peaked years earlier. Peer influence drove the rise; perceived risk from overdose deaths ended it.",
    quote: "Hazard rates of heroin initiation from prior prescription opioid use rose through 2013, driven primarily by processes of social influence, before eventually falling as growing overdose deaths increased the perceived risk of heroin use.",
    source: "Lim et al. 2022, Shifting Risks Over Time; Fig. 3 B and C",
    paper: "Heroin initiation kept rising after pill misuse and pill addiction peaked around 2009–2011.",
    loops: [PEERS, RISK],
    charts: [
      { label: "Starting heroin after pills", keys: STARTS_FROM_PILLS, hover: `flow:${STARTS_FROM_PILLS.join("|")}`, unit: "/yr" },
      { label: "Misusing pills, not addicted", keys: ["rx misuse no py heroin"], hover: "stock:rx misuse no py heroin", unit: "" },
      { label: "Peers using heroin (1999 = 1)", keys: ["si on initiating heroin relative"], hover: `loop:${PEERS}`, unit: "" },
      { label: "Perceived risk of heroin (1999 = 1)", keys: ["perceived risk heroin use relative"], hover: `loop:${RISK}`, unit: "" },
    ],
    metrics: [
      { label: "Peak of starts from pills", value: (app, run) => peak(app, run, STARTS_FROM_PILLS).value, format: (v, run, app) => `${formatNumber(v)}/yr in ${Math.floor(peak(app, run, STARTS_FROM_PILLS).time)}` },
    ],
    alternatives: [
      { id: "fitted", label: "As fitted", note: "Both loops on, as calibrated." },
      { id: "no-peers", label: "Peer loop off", note: "Heroin users no longer draw others in: no rise.", loopsOff: [PEERS] },
      { id: "no-risk", label: "Risk loop off", note: "Overdoses no longer scare anyone off: no fall.", loopsOff: [RISK] },
    ],
  },
  {
    id: "peak",
    title: "Deaths peak and then fall in every future, because of the risk response",
    claim: "Heroin and fentanyl deaths keep rising for a few years and then decline under optimistic, middle and pessimistic assumptions alike, as the risk response keeps cutting the number of people who start.",
    quote: "In all three scenarios, the trend eventually reverses and deaths start to decline as the prevalence of heroin/IMF use falls. Projections from other models … may miss the impending peak and decline.",
    source: "Lim et al. 2022, Policy Analysis Process and Baseline Projections; Fig. 5",
    paper: "543,000 to 842,000 deaths in 2020–2032 in the optimistic and pessimistic scenarios.",
    loops: [RISK],
    charts: [
      { label: "Overdose deaths from heroin and fentanyl", keys: [HEROIN_DEATHS], hover: `var:${HEROIN_DEATHS}`, unit: "/yr" },
      { label: "Addicted to heroin", keys: ["hud no moud", "hud by moud"], hover: "stock:hud no moud|hud by moud", unit: "" },
      { label: "People starting heroin", keys: HEROIN_STARTS, hover: `flow:${HEROIN_STARTS.join("|")}`, unit: "/yr" },
    ],
    metrics: [
      { label: "Heroin deaths peak", value: (app, run) => peak(app, run, [HEROIN_DEATHS]).time, format: (v) => String(Math.floor(v)) },
      { label: "Deaths 2020–2032", value: (app, run) => valueIn(app, run, "projected cumulative overdose deaths", Infinity), format: (v) => formatNumber(v) },
    ],
    alternatives: [
      { id: "base", label: "Trends continue", note: "Inputs keep their recent trends, slowing to 2032." },
      { id: "optimistic", label: "Optimistic", note: "Less fentanyl, more naloxone and treatment, fewer prescriptions.", future: "Pos" },
      { id: "pessimistic", label: "Pessimistic", note: "More fentanyl, less naloxone and treatment, prescribing cuts weaken.", future: "Neg" },
      { id: "no-risk", label: "Trends continue, risk loop off", note: "What a model without the risk response projects.", loopsOff: [RISK] },
    ],
  },
];

export function renderHypotheses(root: HTMLElement, app: MapApp) {
  const index = HYPOTHESES.findIndex((h) => h.id === app.hypothesis);
  root.innerHTML = `<div class="hyp-head">
      <h2>Hypotheses</h2>
      <span class="cycle"><button data-hyp="prev" title="Previous (←)">‹</button><span>${index < 0 ? "–" : index + 1}/${HYPOTHESES.length}</span><button data-hyp="next" title="Next (→)">›</button></span>
    </div>
    <p class="hint">Claims from the paper. Unfold one to see the model's evidence; pick a row to run the whole map in that state.</p>
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

export function alternativeWhatIf(app: MapApp, alt: Alternative): WhatIf {
  const edits = new Map<number, number>();
  for (const loop of app.loops) if (alt.loopsOff?.includes(loop.id)) for (const [cell, value] of knockoutCells(app.sem, loop)) edits.set(cell, value);
  return { future: alt.future ?? "Base", noFentanyl: !!alt.noFentanyl, lever: "None", strength: "20", edits };
}

function section(app: MapApp, h: Hypothesis, index: number): string {
  const open = app.hypothesis === h.id;
  return `<section class="hyp${open ? " open" : ""}">
    <header data-hyp="open:${h.id}"><span class="chev">${open ? "▾" : "▸"}</span><span class="num">${index + 1}</span><span class="title">${escapeHtml(h.title)}</span></header>
    ${open ? body(app, h) : ""}
  </section>`;
}

function body(app: MapApp, h: Hypothesis): string {
  const runs = h.alternatives.map((alt) => app.runs.current(alternativeWhatIf(app, alt)));
  const active = h.alternatives.findIndex((alt) => app.alternative === `${h.id}:${alt.id}`);
  return `<div class="hyp-body">
    <p class="claim">${escapeHtml(h.claim)}</p>
    <blockquote>${escapeHtml(h.quote)}<cite>${escapeHtml(h.source)}</cite></blockquote>
    ${h.charts.map((c) => chartBlock(app, c, h, runs, active)).join("")}
    ${alternativesTable(app, h, runs, active)}
    <p class="paper"><b>Paper:</b> ${escapeHtml(h.paper)}</p>
  </div>`;
}

// One line per alternative; the active one is drawn on top and thicker. The scale follows the first and
// the active alternative, so a runaway one (a loop switched off) breaks off at the top instead of
// flattening the rest.
function chartBlock(app: MapApp, c: Chart, h: Hypothesis, runs: RunResult[], active: number): string {
  const series = runs.map((run) => sum(app, run, c.keys));
  const limit = 1.6 * Math.max(...[0, active].filter((i) => i >= 0).map((i) => Math.max(...series[i])));
  const offScale = series.flatMap((values, i) => (Math.max(...values) > limit ? [h.alternatives[i].label] : []));
  const order = series.map((_, i) => i).sort((a, b) => Number(a === active) - Number(b === active));
  const lines = order.map((i) => ({
    values: series[i].map((v) => (v > limit ? NaN : v)),
    color: ALT_COLORS[i % ALT_COLORS.length],
    width: i === active ? 2.2 : 1.2,
  }));
  const note = offScale.length ? `<span class="off-scale">${escapeHtml(offScale.join(", "))} goes off the scale</span>` : "";
  return `<div class="hyp-chart"><div class="label" data-hover="${escapeHtml(c.hover)}">${escapeHtml(c.label)}</div>${note}
    ${chart({ times: app.current.times, lines, markers: [{ time: DATA_ENDS, label: "data ends" }], width: 316, height: 104 })}</div>`;
}

function alternativesTable(app: MapApp, h: Hypothesis, runs: RunResult[], active: number): string {
  const values = runs.map((run) => h.metrics.map((m) => m.value(app, run)));
  const rows = h.alternatives.map((alt, i) => {
    const cells = h.metrics.map((m, j) => {
      const delta = i > 0 && m.label.startsWith("Deaths") ? ` <small>${signed(values[i][j] - values[0][j])}</small>` : "";
      return `<td>${escapeHtml(m.format(values[i][j], runs[i], app))}${delta}</td>`;
    });
    return `<tr class="${i === active ? "active" : ""}" data-hyp="alt:${h.id}:${alt.id}" title="${escapeHtml(alt.note)}">
      <th><i style="background:${ALT_COLORS[i % ALT_COLORS.length]}"></i>${escapeHtml(alt.label)}</th>${cells.join("")}</tr>`;
  });
  return `<table class="alts"><thead><tr><th>Click a row to apply it</th>${h.metrics.map((m) => `<th>${escapeHtml(m.label)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
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

function peak(app: MapApp, run: RunResult, keys: string[]): { time: number; value: number } {
  const values = sum(app, run, keys);
  let best = 0;
  values.forEach((v, i) => (v > values[best] ? (best = i) : 0));
  return { time: run.times[best], value: values[best] };
}

function valueIn(app: MapApp, run: RunResult, key: string, year: number): number {
  return app.runs.valueAt(run, key, year);
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v))}`;
}
