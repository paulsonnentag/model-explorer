// The fitted run before and after the change, side by side: the headline numbers, and the outputs the
// papers report as charts. Where the authors published runs for both versions, their numbers are shown
// with ours, as a check that the change does here what it did for them.

import type { RunResult } from "../core/compile.ts";
import { chart, formatNumber, type Line, type Points } from "../shared/chart.ts";
import { escapeHtml } from "../shared/html.ts";
import { totalSeries } from "../shared/totals.ts";
import type { PanelView, ReviewApp } from "./app.ts";
import { FITTED, type PublishedRow, type Side } from "./review.ts";

const BEFORE = "#8b939c";
const AFTER = "#2f6db5";
const REFITTED = "#d9822b";
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
    const sides = [...new Set(r.published.map((p) => p.side))];
    const legend = `<div class="legend"><span><i style="border-color:${BEFORE}" class="dash"></i>Before the change</span><span><i style="background:${AFTER}"></i>After</span>${
      sides.length ? `<span><i class="dot" style="background:${BEFORE}"></i><i class="dot" style="background:${AFTER}"></i>${sides.includes("refitted") ? `<i class="dot" style="background:${REFITTED}"></i>` : ""}The authors' published runs</span>` : ""
    }</div>`;
    body.innerHTML = `<p class="hint">Both versions of the model run here, in your browser, under the baseline future.${sides.length ? " Dots are the authors' own published runs of each version." : ""}</p>
      ${legend}
      <table class="measures"><thead><tr><th></th><th>Before</th><th>After</th><th>Change</th>${sides.length ? `<th>Published</th>` : ""}</tr></thead>
      <tbody>${MEASURES.map((m) => measureRow(r.base, r.head, before, after, m, r.published, sides)).join("")}</tbody></table>
      ${CHARTS.map((c) => chartHtml(app, c, before, after, r.published)).join("")}`;
  },
  source: (app) => (app.review.change.published ? `<a data-open="source:${escapeHtml(app.review.change.published)}">${escapeHtml(app.review.change.published)}</a>` : `<span class="muted">our runs of both versions</span>`),
};

function measureRow(base: Side, head: Side, before: RunResult, after: RunResult, m: Measure, published: PublishedRow[], sides: string[]): string {
  const b = base.runs.valueAt(before, m.key, m.time === 2032 ? Infinity : m.time);
  const a = head.runs.valueAt(after, m.key, m.time === 2032 ? Infinity : m.time);
  const pub = (side: string) => published.find((p) => p.key === m.key && p.side === side && p.time === m.time)?.value;
  const theirs = sides.length
    ? `<td class="pub">${sides
        .map((side) => pub(side))
        .map((v, i) => (v === undefined ? "" : `<span style="color:${[BEFORE, AFTER, REFITTED][i]}">${formatNumber(v)}</span>`))
        .join(" → ")}</td>`
    : "";
  const delta = a - b;
  const share = b ? (100 * delta) / Math.abs(b) : 0;
  return `<tr data-hover="var:${escapeHtml(m.key)}" data-var="${escapeHtml(m.key)}"><td>${escapeHtml(m.label)}</td><td>${formatNumber(b)}</td><td><b>${formatNumber(a)}</b></td>
    <td class="${Math.abs(share) < 0.05 ? "flat" : delta > 0 ? "up" : "down"}">${Math.abs(share) < 0.05 ? "same" : `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))} (${share > 0 ? "+" : "−"}${Math.abs(share).toFixed(1)}%)`}</td>${theirs}</tr>`;
}

function chartHtml(app: ReviewApp, c: { label: string; key: string }, before: RunResult, after: RunResult, published: PublishedRow[]): string {
  const r = app.review;
  const lines: Line[] = [
    { values: totalSeries(r.base.model, r.base.sem, before, c.key), color: BEFORE, dash: "4 3", width: 1.4 },
    { values: totalSeries(r.head.model, r.head.sem, after, c.key), color: AFTER, width: 2 },
  ];
  const points: Points[] = (["before", "after", "refitted"] as const).flatMap((side, i) => {
    const rows = published.filter((p) => p.key === c.key && p.side === side);
    return rows.length ? [{ times: rows.map((p) => p.time), values: rows.map((p) => p.value), color: [BEFORE, AFTER, REFITTED][i] }] : [];
  });
  return `<div class="r-chart" data-hover="var:${escapeHtml(c.key)}" data-var="${escapeHtml(c.key)}" data-open="map>var:${escapeHtml(c.key)}" title="Click to show it on the map">
    <div class="label">${escapeHtml(c.label)}</div>
    ${chart({ times: Array.from(after.times), lines, points, markers: [{ time: 2022, label: "policies start" }], width: CHART_W, height: 120 })}
  </div>`;
}
