// The fitted run before and after the change, side by side: the headline numbers, and the outputs the
// papers report as charts.

import type { RunResult } from "../core/compile.ts";
import { chart, formatNumber, type Line } from "../shared/chart.ts";
import { escapeHtml } from "../shared/html.ts";
import { totalSeries } from "../shared/totals.ts";
import type { PanelView, ReviewApp } from "./app.ts";
import { FITTED, type Side } from "./review.ts";

const BEFORE = "#8b939c";
const AFTER = "#2f6db5";
const CHART_W = 520;

type Measure = { label: string; key: string; time: number };

const MEASURES: Measure[] = [
  { label: "Overdose deaths, 2020–2032", key: "projected cumulative overdose deaths", time: 2032 },
  { label: "Years lived with a use disorder, 2020–2032", key: "projected cumulative ud person years", time: 2032 },
  { label: "Overdose deaths in 2020", key: "total overdose deaths", time: 2020 },
  { label: "Overdose deaths in 2032", key: "total overdose deaths", time: 2032 },
  { label: "People with a use disorder in 2032", key: "total with ud", time: 2032 },
];

const CHARTS = [
  { label: "Overdose deaths per year", key: "total overdose deaths" },
  { label: "People with a use disorder", key: "total with ud" },
  { label: "People with heroin use disorder", key: "hud total" },
  { label: "People starting heroin per year", key: "total heroin initiation" },
];

export const resultsPanel: PanelView = {
  width: () => 600,
  kind: () => "Results",
  title: () => "The fitted run, before and after",
  render(body, app) {
    const r = app.review;
    const [before, after] = [r.base.runs.current(FITTED), r.head.runs.current(FITTED)];
    const legend = `<div class="legend"><span><i style="border-color:${BEFORE}" class="dash"></i>Before the change</span><span><i style="background:${AFTER}"></i>After</span></div>`;
    body.innerHTML = `<p class="hint">Both versions of the model run here, in your browser, under the baseline future.</p>
      ${legend}
      <table class="measures"><thead><tr><th></th><th>Before</th><th>After</th><th>Change</th></tr></thead>
      <tbody>${MEASURES.map((m) => measureRow(r.base, r.head, before, after, m)).join("")}</tbody></table>
      ${CHARTS.map((c) => chartHtml(app, c, before, after)).join("")}`;
  },
  source: () => `<span class="muted">our runs of both versions</span>`,
};

function measureRow(base: Side, head: Side, before: RunResult, after: RunResult, m: Measure): string {
  const b = base.runs.valueAt(before, m.key, m.time === 2032 ? Infinity : m.time);
  const a = head.runs.valueAt(after, m.key, m.time === 2032 ? Infinity : m.time);
  const delta = a - b;
  const share = b ? (100 * delta) / Math.abs(b) : 0;
  return `<tr data-hover="var:${escapeHtml(m.key)}" data-var="${escapeHtml(m.key)}"><td>${escapeHtml(m.label)}</td><td>${formatNumber(b)}</td><td><b>${formatNumber(a)}</b></td>
    <td class="${Math.abs(share) < 0.05 ? "flat" : delta > 0 ? "up" : "down"}">${Math.abs(share) < 0.05 ? "same" : `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))} (${share > 0 ? "+" : "−"}${Math.abs(share).toFixed(1)}%)`}</td></tr>`;
}

function chartHtml(app: ReviewApp, c: { label: string; key: string }, before: RunResult, after: RunResult): string {
  const r = app.review;
  const lines: Line[] = [
    { values: totalSeries(r.base.model, r.base.sem, before, c.key), color: BEFORE, dash: "4 3", width: 1.4 },
    { values: totalSeries(r.head.model, r.head.sem, after, c.key), color: AFTER, width: 2 },
  ];
  return `<div class="r-chart" data-hover="var:${escapeHtml(c.key)}" data-var="${escapeHtml(c.key)}" data-open="map>var:${escapeHtml(c.key)}" title="Click to show it on the map">
    <div class="label">${escapeHtml(c.label)}</div>
    ${chart({ times: Array.from(after.times), lines, markers: [{ time: 2022, label: "policies start" }], width: CHART_W, height: 120 })}
  </div>`;
}
