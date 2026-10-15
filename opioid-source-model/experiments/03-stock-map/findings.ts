// Findings from the two papers, read from opioid-model/findings/. A finding shows the model's charts
// for each of its runs at once, against historical data where there is some; choosing a run runs the
// whole trail in that state, with the first run as the dashed comparison. No run removes a part of
// the fitted model: these show how the model produces its behaviour and what it projects, they do
// not test it.

import type { RunResult } from "../core/compile.ts";
import { type Points, chart, formatNumber } from "../shared/chart.ts";
import { escapeHtml } from "../shared/html.ts";
import { FAMILIES, loopTitle } from "../shared/loops.ts";
import type { WhatIf } from "../shared/runs.ts";
import { totalSeries } from "../shared/totals.ts";
import { type MapApp, sourceLink } from "./context.ts";
import type { Alternative, Chart, Finding, Measure } from "./finding-file.ts";
import { PAPERS } from "./paper.ts";
import type { PanelView } from "./trail.ts";
import { whatIfFile } from "./whatifs.ts";

const DATA_ENDS = 2020.5;
const ALT_COLORS = ["#1f2328", "#e11d48", "#2563eb", "#d97706"];
const DATA_COLOR = "#6b7280";
const CHART_W = 336;

export const findingsPanel: PanelView = {
  static: true,
  width: () => 340,
  kind: () => "Findings",
  title: () => "Claims from the papers",
  render(body, app) {
    body.innerHTML = `<p class="hint">Chosen by us from the two papers. Each shows how the model produces the behaviour, against historical data where there is some, with the authors' own alternative runs. They explain the model; they do not test it.</p>
      <div class="rows">${app.findings
        .map(
          (f) => `<a class="row" data-open="finding:${escapeHtml(f.id)}"><span class="num">${f.number}</span><span><b>${escapeHtml(f.title)}</b><small>${escapeHtml(PAPERS[f.paper]?.short ?? f.paper)} · p. ${f.anchors[0]?.page ?? "?"}</small></span></a>`,
        )
        .join("")}</div>`;
  },
  source: () => `<a data-open="files>findings">findings/</a>`,
};

export const findingPanel: PanelView = {
  width: () => 380,
  kind: (app, id) => `Finding ${findingOf(app, id).number}`,
  title: (app, id) => findingOf(app, id).title,
  render(body, app, id) {
    const f = findingOf(app, id);
    const runs = f.runs.map((alt) => app.runs.current(alternativeWhatIf(alt)));
    const active = f.runs.findIndex((alt) => app.alternative === `${f.id}:${alt.id}`);
    const loops = f.loops.flatMap((driver) => app.loops.filter((l) => l.driver === driver));
    body.innerHTML = `<p class="claim">${escapeHtml(f.claim)}</p>
      <blockquote>${escapeHtml(f.quote)}<cite><a data-open="paper:${escapeHtml(f.paper)}>finding:${escapeHtml(f.id)}" title="Show the passage in the paper">${escapeHtml(f.source)} · p. ${f.anchors[0]?.page ?? "?"}</a></cite></blockquote>
      ${loops.length ? `<div class="links">Loop: ${loops.map((l) => `<a class="chip loop-chip" style="--c:${FAMILIES[l.family].color}" data-open="loop:${escapeHtml(l.id)}" data-hover="loop:${escapeHtml(l.id)}">${escapeHtml(loopTitle(l, app.plain))}</a>`).join("")}</div>` : ""}
      ${f.charts.map((c) => chartBlock(app, f, c, runs, active)).join("")}
      ${runsTable(app, f, runs, active)}
      <p class="paper"><b>Paper:</b> ${escapeHtml(f.paperNumbers)}</p>
      ${f.caveat ? `<p class="caveat">${escapeHtml(f.caveat)}</p>` : ""}`;
    body.onclick = (e) => {
      const target = e.target as Element;
      if (target.closest("[data-open]")) return;
      const row = target.closest<HTMLElement>("[data-run]");
      if (row) app.actions.applyAlternative(f.id, row.dataset.run!);
    };
  },
  source: (app, id) => {
    const file = findingOf(app, id).file;
    return `<a data-open="source:${escapeHtml(file)}">${escapeHtml(file)}</a>`;
  },
};

export function findingOf(app: MapApp, id: string): Finding {
  return app.findings.find((f) => f.id === id)!;
}

export function alternativeWhatIf(alt: Alternative): WhatIf {
  return { future: alt.future ?? "Base", noFentanyl: alt.history === "NoFentHist", lever: alt.policy ?? "None", strength: alt.strength ?? "20", edits: new Map() };
}

// One line per run; the active one is drawn on top and thicker. Absolute charts scale to the first
// and the active run, so a runaway one breaks off at the top instead of flattening the rest.
// Hovering the chart lights up what it plots on the map.
function chartBlock(app: MapApp, f: Finding, c: Chart, runs: RunResult[], active: number): string {
  const times = app.current.times;
  const start = Math.max(0, times.findIndex((t) => t >= (c.from ?? times[0])));
  const raw = runs.map((run) => sum(app, run, c.keys));
  const series = c.relative ? raw.map((values) => values.map((v, i) => (raw[0][i] ? (100 * (v - raw[0][i])) / raw[0][i] : 0))) : raw;
  const shown = series.map((values) => values.slice(start));
  const limit = c.relative ? Infinity : 1.6 * Math.max(...[0, active].filter((i) => i >= 0).map((i) => Math.max(...shown[i])));
  const offScale = shown.flatMap((values, i) => (Math.max(...values) > limit ? [f.runs[i].label] : []));
  const order = shown.map((_, i) => i).sort((a, b) => Number(a === active) - Number(b === active));
  const lines = order.map((i) => ({
    values: shown[i].map((v) => (v > limit ? NaN : v)),
    color: ALT_COLORS[i % ALT_COLORS.length],
    width: i === active ? 2.2 : 1.2,
  }));
  const note = offScale.length ? `<span class="off-scale">${escapeHtml(offScale.join(", "))} goes off the scale</span>` : "";
  const markers = times[start] < DATA_ENDS ? [{ time: DATA_ENDS, label: "data ends" }] : [];
  const points = c.relative ? [] : dataPoints(app, c, times[start]);
  const dots = points.length ? `<div class="dots">Dots: ${c.data.map((key) => `<span data-hover="var:${escapeHtml(key)}">${escapeHtml(key)}</span> ${sourceLink(app, key)}`).join(", ")}</div>` : "";
  const hover = hoverOf(app, c.keys);
  return `<div class="f-chart" data-hover="${escapeHtml(hover)}" data-var="${escapeHtml(c.keys.join("|"))}" data-open="map>${escapeHtml(hover)}" title="Click to show it on the map">
    <div class="label">${escapeHtml(c.label)} ${c.keys.length === 1 ? sourceLink(app, c.keys[0]) : ""}</div>${note}
    ${chart({ times: times.slice(start), lines, points, markers, width: CHART_W, height: 104 })}${dots}</div>`;
}

// Flows light up their arrows, groups their boxes, anything else what it is computed from.
function hoverOf(app: MapApp, keys: string[]): string {
  if (keys.every((k) => app.layout.edges.some((e) => e.flows.some((fl) => fl.key === k)))) return `flow:${keys.join("|")}`;
  if (keys.every((k) => app.layout.nodes.some((n) => n.key === k))) return `stock:${keys.join("|")}`;
  return `var:${keys[0]}`;
}

function runsTable(app: MapApp, f: Finding, runs: RunResult[], active: number): string {
  const values = runs.map((run) => f.measures.map((m) => measureValue(app, m, run, runs[0])));
  const rows = f.runs.map((alt, i) => {
    const cells = f.measures.map((m, j) => {
      const diff = values[i][j] - values[0][j];
      const delta = i === 0 || !m.compare ? "" : ` <small>${m.compare === "difference" ? signed(diff) : percent((100 * diff) / values[0][j])}</small>`;
      return `<td>${escapeHtml(formatMeasure(m, values[i][j]))}${delta}</td>`;
    });
    const file = whatIfFile(app, alternativeWhatIf(alt));
    return `<tr class="${i === active ? "active" : ""}" data-run="${escapeHtml(alt.id)}" title="${escapeHtml(alt.note)}">
      <th><i style="background:${ALT_COLORS[i % ALT_COLORS.length]}"></i>${escapeHtml(alt.label)}${file ? `<a class="src" data-open="source:${escapeHtml(file)}">${escapeHtml(file.split("/").pop()!)}</a>` : ""}</th>${cells.join("")}</tr>`;
  });
  return `<table class="alts"><thead><tr><th>Click a run to apply it</th>${f.measures.map((m) => `<th>${escapeHtml(m.label)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function measureValue(app: MapApp, m: Measure, run: RunResult, base: RunResult): number {
  const values = sum(app, run, m.keys);
  const step = (year: number) => (year === Infinity ? values.length - 1 : Math.round((year - run.times[0]) / (run.times[1] - run.times[0])));
  if (m.kind === "at") return values[step(m.year!)];
  if (m.kind === "summed") return values.slice(0, step(m.year!)).reduce((total, v) => total + v * (run.times[1] - run.times[0]), 0);
  if (m.kind === "peak") return run.times[values.indexOf(Math.max(...values))];
  const theirs = sum(app, base, m.keys);
  return Math.min(0, ...values.map((v, i) => (theirs[i] ? (100 * (v - theirs[i])) / theirs[i] : 0)));
}

function formatMeasure(m: Measure, v: number): string {
  if (m.kind === "peak") return String(Math.floor(v));
  if (m.kind === "drop") return percent(v);
  return formatNumber(v);
}

// The chart's historical series, summed year by year where every series has a value.
function dataPoints(app: MapApp, c: Chart, from: number): Points[] {
  if (!c.data.length) return [];
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

function percent(v: number): string {
  if (Math.abs(v) < 0.05) return "0%";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v))}`;
}
