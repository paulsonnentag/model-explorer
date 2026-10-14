// The right-hand side: an exploded view of whatever is selected in the paper. Parts that depend on
// model runs are marked `data-live` and redrawn in place when an assumption is changed.

import { chart, formatNumber, type Band, type Line, type Points } from "../shared/chart.ts";
import { escapeHtml, explorerLink, sourceLink } from "../shared/html.ts";
import { LAYERS, ROLES, type Role } from "../shared/semantics.ts";
import type { PaperApp, Status } from "./context.ts";
import {
  RUN_LABELS,
  STATUS_TEXT,
  dataPoints,
  evaluateClaim,
  evaluateRow,
  explorerQuery,
  publishedName,
  publishedValues,
  runOf,
  seriesValues,
  stepOf,
} from "./context.ts";
import { cachedInfluence, figureSeries, itemVariables, rankInfluence, upstream, type Influence } from "./influence.ts";
import type { Chart, Claim, Figure, Item, Panel, RunKey, Series, TableRow } from "./items.ts";
import { CLAIMS, FIGURES, FIGURES_DIR, NOTEBOOK, TABLE_ROWS } from "./items.ts";

const live = new Map<string, () => string>();
const REFERENCE = "#b3b7bc";
const PUBLISHED = "rgba(0, 0, 0, 0.6)";

export function renderDetail(el: HTMLElement, app: PaperApp) {
  live.clear();
  const s = app.selection;
  const body = !s ? scorecard(app) : s.item.kind === "figure" ? figureView(app, s.item, s.sub) : s.item.kind === "row" ? rowView(app, s.item) : claimView(app, s.item);
  el.innerHTML = `${liveBlock("edits", () => editsBar(app))}${body}`;
  el.scrollTop = 0;
  updateLive(el, app);
}

export function updateLive(el: HTMLElement, app: PaperApp) {
  for (const [id, render] of live) {
    const target = el.querySelector<HTMLElement>(`[data-live="${id}"]`);
    if (target) target.innerHTML = render();
  }
  wireLive(el, app);
}

// ---------- Nothing selected: what is in the paper and how much of it holds up ----------

function scorecard(app: PaperApp): string {
  const claims = CLAIMS.map((c) => ({ claim: c, ...evaluateClaim(app, c, new Map()) }));
  const rows = TABLE_ROWS.map((r) => ({ row: r, ...evaluateRow(app, r, new Map()) }));
  const count = (status: Status) => claims.filter((c) => c.status === status).length + rows.filter((r) => r.status === status).length;
  return `
    <header class="d-head">
      <div class="eyebrow">Lim et al. 2022 · PNAS 119(23)</div>
      <h1>The paper, rebuilt live</h1>
      <p class="lede">Every figure, Table 1 row and highlighted number on the left is linked to the model. Click one to see what it is made of:
        the variables it plots, the data it is compared with, the assumptions it rests on, and a re-run of the model in your browser.</p>
      <div class="tally">
        <span class="pill reproduced">${count("reproduced")} reproduced</span>
        <span class="pill close">${count("close")} close</span>
        <span class="pill differs">${count("differs")} differ</span>
        <span class="muted">reproduced: within 1% · close: within 10%</span>
      </div>
    </header>
    <section>
      <h2>Figures</h2>
      <ul class="index">${FIGURES.map(
        (f) => `<li><a data-select="${f.id}"><b>${escapeHtml(f.label)}</b> ${escapeHtml(f.title)}</a>
          <span class="muted">${f.panels.length ? `${f.panels.length} panels · ` : ""}${f.runs.map((r) => (r === "NoFent" ? "NoFentHist" : r)).join(", ")}</span></li>`,
      ).join("")}</ul>
    </section>
    <section>
      <h2>Numbers in the text</h2>
      <ul class="index">${claims
        .map(
          ({ claim, result, status }) => `<li><a data-select="${claim.id}">${statusPill(status)} ${escapeHtml(claim.label)}</a>
          <span class="muted">paper ${claim.paperValues.map(claim.format).join(" / ")} · model ${result.values.map(claim.format).join(" / ")}</span></li>`,
        )
        .join("")}</ul>
    </section>
    <section>
      <h2>Table 1: assumptions about the inputs</h2>
      <ul class="index">${rows
        .map(({ row, status }) => `<li><a data-select="${row.id}">${statusPill(status)} ${escapeHtml(row.label)}</a> <span class="muted">${escapeHtml(row.source)}</span></li>`)
        .join("")}</ul>
    </section>`;
}

// ---------- Figures ----------

function figureView(app: PaperApp, figure: Figure, sub?: string): string {
  const panel = figure.panels.find((p) => p.id === sub);
  const part = figure.parts?.find((p) => p.id === sub);
  const loop = figure.loops?.find((l) => l.id === sub);
  const ordered = panel ? [panel, ...figure.panels.filter((p) => p !== panel)] : figure.panels;
  return `
    <header class="d-head">
      <div class="eyebrow">${escapeHtml(figure.label)} · page ${figure.page}${panel ? ` · ${escapeHtml(panel.title)}` : ""}</div>
      <h1>${escapeHtml(figure.title)}</h1>
      <p class="caption">${escapeHtml(figure.caption)}</p>
      ${liveBlock("badges", () => figureBadges(app, figure))}
    </header>
    ${figure.parts && part ? partsSection(app, figure, part.id) : ""}
    ${figure.loops ? loopsSection(app, figure, loop?.id) : ""}
    ${figure.parts && !part ? partsSection(app, figure) : ""}
    ${
      figure.panels.length
        ? `<section>
            <h2>Rebuilt live</h2>
            <p class="hint">Solid lines are this browser's run. A dotted black line is Vensim's published run for comparison; a gray dashed line appears once you change an assumption.</p>
            <div class="panels ${figure.id}">${ordered.map((p, i) => panelCard(app, figure, p, panel ? i === 0 : ordered.length === 1)).join("")}</div>
          </section>`
        : ""
    }
    ${figure.panels.length ? plottedSection(app, figure, panel) : ""}
    ${figure.panels.length ? dataSection(app, figure, panel) : ""}
    ${restsOnSection(app, figure, figure.runs)}
    ${madeSection(figure)}`;
}

function panelCard(app: PaperApp, figure: Figure, panel: Panel, featured: boolean): string {
  const width = featured ? 560 : 270;
  const id = `panel-${panel.id}`;
  return `<div class="card${featured ? " featured" : ""}" data-panel="${panel.id}">
    <div class="card-title"><a data-select="${figure.id}/${panel.id}">${escapeHtml(panel.title)}</a></div>
    ${liveBlock(id, () => panel.charts.map((c) => chartHtml(app, panel, c, width, featured ? 210 : panel.charts.length > 1 ? 110 : 150)).join(""))}
    ${legend(panel.charts.flatMap((c) => c.series))}
  </div>`;
}

function chartHtml(app: PaperApp, panel: Panel, spec: Chart, width: number, height: number): string {
  const times = runOf(app, "Base").times;
  const i0 = stepOf(times, panel.from);
  const i1 = stepOf(times, panel.to) + 1;
  const slice = (v: ArrayLike<number>) => Array.from(v).slice(i0, i1);
  const lines: Line[] = [];
  const points: Points[] = [];
  const edited = app.edits.size > 0;
  const ours = spec.series.map((s) => seriesValues(app, s, spec.divisor));
  spec.series.forEach((s, i) => {
    if (s.kind === "data") {
      const p = dataPoints(app, ours[i], panel.from, panel.to);
      points.push({ ...p, color: s.color });
      return;
    }
    if (s.kind === "data-line") {
      const p = dataPoints(app, ours[i], panel.from, panel.to);
      lines.push({ values: interpolate(slice(times), p), color: s.color, dash: s.dash, width: 1.4 });
      return;
    }
    if (edited) lines.push({ values: slice(seriesValues(app, s, spec.divisor, new Map())), color: REFERENCE, dash: "4,3", width: 1.3 });
    const published = publishedValues(app, s, spec.divisor);
    lines.push({ values: slice(ours[i]), color: s.color, dash: s.dash, width: 2 });
    if (published) lines.push({ values: slice(published), color: PUBLISHED, dash: "1,3", width: 0.9 });
  });
  const bands: Band[] = (spec.bands ?? []).map((b) => ({ lower: slice(ours[b.between[0]]), upper: slice(ours[b.between[1]]), color: b.color }));
  const markers = panel.to > 2021 ? [{ time: 2020, label: "projection" }] : [];
  return `<div class="chart"><div class="unit">${escapeHtml(spec.unit)}</div>${chart({ times: slice(times), lines, points, bands, markers, width, height })}</div>`;
}

function legend(series: Series[]): string {
  const seen = new Set<string>();
  const items = series.filter((s) => !seen.has(s.label) && seen.add(s.label));
  if (items.length < 2) return "";
  return `<div class="legend">${items
    .map((s) => `<span><i style="background:${s.color}${s.kind === "data" ? ";border-radius:50%" : ""}"></i>${escapeHtml(s.label)}</span>`)
    .join("")}</div>`;
}

function figureBadges(app: PaperApp, figure: Figure): string {
  const runs = figure.runs.length;
  const badges = [`<span class="pill neutral">Rebuilt in your browser from ${runs} model run${runs > 1 ? "s" : ""} (${app.runs.lastRunMs.toFixed(0)} ms each)</span>`];
  if (app.edits.size) badges.push(`<span class="pill close">Changed assumptions: this is no longer the published run</span>`);
  else {
    const deviation = publishedDeviation(app, figure);
    if (deviation === null) badges.push(`<span class="pill neutral">${figure.panels.length ? "Loading Vensim's published runs…" : "Diagram; no published run to compare"}</span>`);
    else badges.push(`<span class="pill ${deviation < 0.01 ? "reproduced" : "close"}">${STATUS_TEXT[deviation < 0.01 ? "reproduced" : "close"].mark} Matches Vensim's published runs within ${formatPercent(deviation)}</span>`);
  }
  return `<div class="badges">${badges.join("")}</div>`;
}

// The largest gap between this engine and Vensim's published run, relative to the series' peak.
function publishedDeviation(app: PaperApp, figure: Figure): number | null {
  let worst = 0;
  let compared = 0;
  for (const panel of figure.panels) {
    for (const spec of panel.charts) {
      for (const s of spec.series) {
        if (s.kind !== "sim") continue;
        const pub = publishedValues(app, s, spec.divisor);
        if (!pub) continue;
        const ours = seriesValues(app, s, spec.divisor);
        const times = runOf(app, s.run).times;
        let peak = 0;
        let gap = 0;
        for (let i = stepOf(times, Math.max(panel.from, s.from ?? -Infinity)); i <= stepOf(times, panel.to); i++) {
          if (!Number.isFinite(pub[i]) || !Number.isFinite(ours[i])) continue;
          peak = Math.max(peak, Math.abs(pub[i]));
          gap = Math.max(gap, Math.abs(pub[i] - ours[i]));
        }
        if (peak > 0) {
          worst = Math.max(worst, gap / peak);
          compared++;
        }
      }
    }
  }
  return compared ? worst : null;
}

function loopsSection(app: PaperApp, figure: Figure, active?: string): string {
  return `<section>
    <h2>Feedback loops: switch them off</h2>
    <p class="hint">Each switch sets every strength in that loop family to 1e-6 and re-runs the model, holding everything else fixed.</p>
    <div class="loops">${figure
      .loops!.map((loop) => {
        const off = app.editGroups.has(`loop:${loop.id}`);
        return `<label class="loop${loop.id === active ? " featured" : ""}">
          <input type="checkbox" data-loop="${loop.id}"${off ? "" : " checked"}>
          <span class="dot" style="background:${loop.color}"></span>
          <span><b>${escapeHtml(loop.title)}</b> <span class="muted">${off ? "off" : "on"}</span><br><span class="muted">${escapeHtml(loop.description)}</span>
          <br><span class="small">${loop.variables.length} strengths: ${loop.variables
            .slice(0, 3)
            .map((k) => `<a href="${explorerLink(k)}" target="_blank">${escapeHtml(app.sem.vars.get(k)?.name ?? k)}</a>`)
            .join(", ")}${loop.variables.length > 3 ? ", …" : ""}</span></span>
        </label>`;
      })
      .join("")}</div>
    ${liveBlock("loop-outcomes", () => loopOutcomes(app))}
  </section>`;
}

function loopOutcomes(app: PaperApp): string {
  const outcomes: [string, string, number, string][] = [
    ["Total overdose deaths", "total overdose deaths", 1e3, "thousands/year"],
    ["People with use disorder", "total with ud", 1e6, "millions"],
    ["Total heroin initiation", "total heroin initiation", 1e6, "millions/year"],
  ];
  const panel: Panel = { id: "loops", title: "", from: 1999, to: 2032, charts: [] };
  return `<div class="panels">${outcomes
    .map(([title, key, divisor, unit]) => {
      const series: Series = { label: title, run: "Base", terms: [key], kind: "sim", color: "#1f77b4" };
      return `<div class="card"><div class="card-title"><a href="${explorerLink(key)}" target="_blank">${escapeHtml(title)}</a></div>${chartHtml(app, panel, { unit, divisor, series: [series] }, 270, 130)}</div>`;
    })
    .join("")}</div>`;
}

function partsSection(app: PaperApp, figure: Figure, active?: string): string {
  const parts = active ? [...figure.parts!.filter((p) => p.id === active), ...figure.parts!.filter((p) => p.id !== active)] : figure.parts!;
  const colors = ["#1f77b4", "#d62728", "#2ca02c", "#ff7f0e"];
  return `<section>
    <h2>The boxes, as model stocks</h2>
    <div class="panels">${parts
      .map((part) => {
        const series: Series[] = part.terms.map((t, i) => ({ label: app.sem.vars.get(t)?.name ?? t, run: "Base", terms: [t], kind: "sim", color: colors[i % colors.length] }));
        const panel: Panel = { id: part.id, title: part.title, from: 1999, to: 2032, charts: [] };
        const featured = part.id === active;
        return `<div class="card${featured ? " featured" : ""}">
          <div class="card-title"><a data-select="${figure.id}/${part.id}">${escapeHtml(part.title)}</a></div>
          <p class="small muted">${escapeHtml(part.description)}</p>
          ${liveBlock(`part-${part.id}`, () => chartHtml(app, panel, { unit: "people", divisor: 1, series }, featured ? 560 : 270, featured ? 190 : 120))}
          ${legend(series)}
          <div class="chips">${part.terms.map((t) => variableChip(app, t)).join("")}</div>
        </div>`;
      })
      .join("")}</div>
  </section>`;
}

function plottedSection(app: PaperApp, figure: Figure, only?: Panel): string {
  const panels = only ? [only] : figure.panels;
  return `<section>
    <h2>What is plotted</h2>
    <table class="plotted">${panels
      .map(
        (p) => `<tr><th>${escapeHtml(p.title)}</th><td>${p.charts
          .flatMap((c) => c.series)
          .map((s) => `<div><span class="swatch" style="background:${s.color}"></span>${escapeHtml(s.label)}${s.run !== "Base" ? ` <span class="muted">(${s.run === "NoFent" ? "NoFentHist" : s.run})</span>` : ""}${s.normalizeAt ? ` <span class="muted">÷ value in ${s.normalizeAt}</span>` : ""}: ${termChips(app, s)}</div>`)
          .join("")}</td></tr>`,
      )
      .join("")}</table>
  </section>`;
}

function termChips(app: PaperApp, series: Series): string {
  const query = explorerQuery(series.run);
  const chips = series.terms.map((term) => {
    const resolved = resolveTerm(app, term, series.kind !== "sim");
    return resolved ? variableChip(app, resolved, query) : `<code>${escapeHtml(term)}</code>`;
  });
  return chips.join(series.terms.length > 1 ? " + " : "");
}

function dataSection(app: PaperApp, figure: Figure, only?: Panel): string {
  const keys = new Set<string>();
  for (const p of only ? [only] : figure.panels) {
    for (const s of p.charts.flatMap((c) => c.series)) {
      for (const term of s.terms) {
        const resolved = resolveTerm(app, term, true);
        if (resolved && (s.kind !== "sim" || term.startsWith("simvar"))) keys.add(resolved);
      }
    }
  }
  const data = [...keys].filter((k) => app.sem.vars.get(k)?.layer === "evidence" || app.sem.vars.get(k)?.measures.length);
  if (!data.length) return "";
  return `<section>
    <h2>Where the data comes from</h2>
    <div class="data-cards">${data.map((k) => dataCard(app, k)).join("")}</div>
  </section>`;
}

function dataCard(app: PaperApp, key: string): string {
  const info = app.sem.vars.get(key)!;
  const def = info.definitions[0];
  const points = info.cells.map((c) => app.model.dataPoints(c)).find((p) => p);
  const computed = !points && info.uses.length;
  return `<div class="data-card">
    <div><a href="${explorerLink(key)}" target="_blank"><b>${escapeHtml(info.name)}</b></a> <span class="role" style="color:${LAYERS[info.layer].color}">${escapeHtml(ROLES[info.role].label)}</span></div>
    ${info.units ? `<div class="small muted">${escapeHtml(info.units)}</div>` : ""}
    ${info.comment ? `<p class="small">${escapeHtml(trimText(info.comment, 260))}</p>` : ""}
    <div class="small">${
      points
        ? `${points.times.length} data points, ${Math.floor(points.times[0])}–${Math.floor(points.times[points.times.length - 1])}, read from Vensim's published run of the data files.`
        : computed
          ? `Computed from: ${info.uses.slice(0, 4).map((k) => variableChip(app, k)).join(" ")}`
          : ""
    }</div>
    ${def ? `<div class="small"><a href="${sourceLink(app.bundle.files.model, def.line)}" target="_blank">Defined in the model file, line ${def.line}</a></div>` : ""}
  </div>`;
}

// ---------- Table 1 rows ----------

function rowView(app: PaperApp, row: TableRow): string {
  const key = `projection output data[${row.element}]`;
  const series: Series[] = [
    { label: "Exogenous trends continue", run: "Base", terms: [key], kind: "sim", color: "#1f77b4" },
    { label: "Optimistic", run: "Pos", terms: [key], kind: "sim", color: "#ff7f0e", from: 2020 },
    { label: "Pessimistic", run: "Neg", terms: [key], kind: "sim", color: "#2ca02c", from: 2020 },
  ];
  const panel: Panel = { id: row.element, title: row.label, from: 1999, to: 2032, charts: [{ unit: row.unit.trim() || "value", divisor: 1 / row.scale, series }] };
  return `
    <header class="d-head">
      <div class="eyebrow">Table 1 · page 5 · source: ${escapeHtml(row.source)}</div>
      <h1>${escapeHtml(row.label)}</h1>
      <p class="caption">An exogenous input: the model does not explain it, it is given. The 2020 value comes from data; the 2032 values are assumptions that define the three futures.</p>
    </header>
    <section>
      <h2>Paper vs. model</h2>
      ${liveBlock("row-table", () => rowTable(app, row))}
    </section>
    <section>
      <h2>Rebuilt live</h2>
      <div class="panels"><div class="card featured">${liveBlock("row-chart", () => chartHtml(app, panel, panel.charts[0], 560, 200))}${legend(series)}</div></div>
      <div class="chips">${variableChip(app, "projection output data")} ${variableChip(app, "projection input data")} ${variableChip(app, row.endValue)}</div>
    </section>
    <section>
      <h2>Where the 2032 values are set</h2>
      ${endValueSources(app, row)}
    </section>
    ${restsOnSection(app, row, ["Base", "Pos", "Neg"])}`;
}

function rowTable(app: PaperApp, row: TableRow): string {
  const v = evaluateRow(app, row);
  const unedited = evaluateRow(app, row, new Map());
  const fmt = (x: number) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en-US") : Number(x.toPrecision(3)).toString());
  const cells = (xs: number[]) => xs.map((x) => `<td>${fmt(x)}${escapeHtml(row.unit)}</td>`).join("");
  return `<table class="compare">
    <tr><th></th><th>2020</th><th>2032 ETC</th><th>2032 optimistic</th><th>2032 pessimistic</th></tr>
    <tr><th>Paper</th>${row.paper.map((p) => `<td>${escapeHtml(p)}</td>`).join("")}</tr>
    <tr><th>This model</th>${cells(v.ours)}</tr>
  </table>
  <div class="verdict">${statusPill(unedited.status)} ${unedited.status === "reproduced" ? "The published model file reproduces every value in this row." : `Largest gap: ${formatPercent(unedited.error)}.`}</div>`;
}

function endValueSources(app: PaperApp, row: TableRow): string {
  const target = row.endValue;
  const sources: { file: string; label: string; value: number | null }[] = [];
  for (const change of app.bundle.baseChanges) {
    const o = change.overrides.find((o) => o.target.toLowerCase() === target);
    if (o) sources.push({ file: change.file, label: "ETC (applied to every run)", value: o.value });
  }
  for (const [name, label] of [["Pos", "Optimistic"], ["Neg", "Pessimistic"]] as const) {
    const scenario = app.bundle.scenarios.find((s) => s.name === name);
    const o = scenario?.overrides.find((o) => o.target.toLowerCase() === target);
    if (scenario) sources.push({ file: scenario.file, label, value: o ? o.value : null });
  }
  return `<table class="compare files">${sources
    .map(
      (s) => `<tr><th>${escapeHtml(s.label)}</th><td><a href="${sourceLink(s.file, undefined, target)}" target="_blank">${escapeHtml(s.file.split("/").pop()!)}</a></td>
        <td>${s.value === null ? '<span class="muted">not set</span>' : `<code>${escapeHtml(app.sem.vars.get(target)?.name ?? target)} = ${s.value}</code>`}</td></tr>`,
    )
    .join("")}</table>
    <p class="hint">The model draws a smooth curve from the last data point (2020) to this value in 2032.</p>`;
}

// ---------- Claims ----------

function claimView(app: PaperApp, claim: Claim): string {
  return `
    <header class="d-head">
      <div class="eyebrow">Claim · page ${claim.page}</div>
      <h1>${escapeHtml(claim.label)}</h1>
      <blockquote>${escapeHtml(claim.quote)}</blockquote>
    </header>
    <section>
      <h2>Paper vs. model</h2>
      ${liveBlock("claim", () => claimNumbers(app, claim))}
      ${claim.note ? `<div class="note">${escapeHtml(claim.note)}</div>` : ""}
    </section>
    <section>
      <h2>How it is computed</h2>
      <p>${escapeHtml(claim.how)}</p>
      ${claim.variables.length ? `<div class="chips">${claim.variables.map((k) => variableChip(app, k, explorerQuery(claim.runs[0] ?? "Base"))).join("")}</div>` : ""}
    </section>
    ${claim.runs.length ? restsOnSection(app, claim, claim.runs) : ""}`;
}

function claimNumbers(app: PaperApp, claim: Claim): string {
  const now = evaluateClaim(app, claim);
  const original = evaluateClaim(app, claim, new Map());
  const changed = app.edits.size > 0;
  return `<div class="numbers">${claim.paperValues
    .map(
      (p, i) => `<div class="number">
        <div><span class="muted">Paper</span><b>${escapeHtml(claim.format(p))}</b></div>
        <div><span class="muted">${changed ? "Published model" : "This model, live"}</span><b>${escapeHtml(claim.format(original.result.values[i]))}</b></div>
        ${changed ? `<div><span class="muted">With your changes</span><b class="changed">${escapeHtml(claim.format(now.result.values[i]))}</b></div>` : ""}
      </div>`,
    )
    .join("")}</div>
    <div class="verdict">${statusPill(original.status)} ${verdictText(original.status, original.error)}</div>
    ${now.result.rows ? `<table class="compare">${now.result.rows.map((r) => `<tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`).join("")}</table>` : ""}`;
}

function verdictText(status: Status, error: number): string {
  if (status === "reproduced") return "The published model reproduces the paper's number.";
  if (status === "close") return `Within ${formatPercent(error)} of the paper's number.`;
  return `Off by ${formatPercent(error)} from the paper's number.`;
}

// ---------- What an item rests on ----------

function restsOnSection(app: PaperApp, item: Item, runs: RunKey[]): string {
  const keys = itemVariables(app, item);
  const roots = upstream(app, keys);
  const byRole = new Map<Role, string[]>();
  for (const key of roots) {
    const info = app.sem.vars.get(key);
    if (!info || !["quantities", "evidence", "what-ifs"].includes(info.layer)) continue;
    byRole.set(info.role, [...(byRole.get(info.role) ?? []), info.name]);
  }
  const roleChips = [...byRole]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([role, names]) => `<span class="chip" style="--c:${LAYERS[ROLES[role].layer].color}" title="${escapeHtml(names.slice(0, 40).join(", "))}${names.length > 40 ? ", …" : ""}">${names.length} ${escapeHtml(ROLES[role].label.toLowerCase())}</span>`)
    .join("");
  return `<section>
    <h2>What it rests on</h2>
    ${keys.length ? `<p class="hint">Following every equation upstream from what is shown, through ${roots.size} model variables:</p><div class="chips">${roleChips}</div>` : ""}
    <h3>Runs and the files that set them up</h3>
    <table class="compare files">${runs.map((run) => runFiles(app, run)).join("")}</table>
    ${keys.length ? `<h3>Which assumptions move it most</h3>${liveBlock("influence", () => influenceBlock(app, item))}` : ""}
  </section>`;
}

function runFiles(app: PaperApp, run: RunKey): string {
  const files = app.bundle.files;
  const scenario = app.bundle.scenarios.find((s) => s.name === (run === "NoFent" ? "NoFentHist" : run));
  const published = publishedName(app, run);
  const link = (file: string, label = file.split("/").pop()!) => `<a href="${sourceLink(file)}" target="_blank">${escapeHtml(label)}</a>`;
  return `<tr><th>${escapeHtml(RUN_LABELS[run])}</th><td>
    ${link(files.model)} → ${link(files.calibrationWeights)} → ${link(files.projectionEndValues)} →
    ${link(files.fittedValues)} <span class="muted">(${app.bundle.fitted.length} fitted values)</span>
    ${scenario ? ` → ${link(scenario.file)} <span class="muted">(${run === "NoFent" ? "only the lines that differ from Base" : `${scenario.overrides.length} lines`})</span>` : ""}
    ${published ? `<br><span class="muted">Compared with Vensim's published run X8_final_${escapeHtml(published)}.tab</span>` : ""}
  </td></tr>`;
}

function influenceBlock(app: PaperApp, item: Item): string {
  const ranked = cachedInfluence(item);
  if (!ranked) {
    const count = upstreamCount(app, item);
    return `<p class="hint">Nudges each of the ${count} upstream constants by 10% and re-runs the model, about ${count * Math.max(1, itemRuns(item))} runs.</p>
      <button class="primary" data-rank="${item.id}">Rank assumptions by influence</button> <span class="progress" data-progress></span>`;
  }
  const top = ranked.filter((r) => r.effect > 0).slice(0, 12);
  if (!top.length) return `<p class="hint">None of the upstream constants moves this noticeably.</p>`;
  const max = top[0].effect;
  return `<p class="hint">Effect of a 10% increase on what is shown (mean relative change). Drag a slider to re-run with a different value; fitted parameters range over their 95% interval.</p>
    <div class="influence">${top.map((r) => influenceRow(app, r, max)).join("")}</div>`;
}

function influenceRow(app: PaperApp, r: Influence, max: number): string {
  const group = app.editGroups.get(`nudge:${r.key}`);
  const factor = group ? [...group.cells.values()][0] / r.base[0] : 1;
  const lo = Math.min(r.lower / r.base[0], 0.5);
  const hi = Math.max(r.upper / r.base[0], 1.5);
  const range = r.lower < r.upper && r.base[0] > 0 ? [Math.min(r.lower / r.base[0], 1), Math.max(r.upper / r.base[0], 1)] : [lo, hi];
  const shown = r.base.length > 1 ? `×${factor.toFixed(2)}` : formatNumber(r.base[0] * factor);
  return `<div class="inf-row">
    <div class="inf-name"><a href="${explorerLink(r.key)}" target="_blank">${escapeHtml(r.name)}</a>
      <span class="role" style="color:${LAYERS[ROLES[r.role].layer].color}">${escapeHtml(ROLES[r.role].label)}</span></div>
    <div class="inf-bar"><i style="width:${((r.effect / max) * 100).toFixed(1)}%"></i><span>${formatPercent(r.effect)}</span></div>
    <input type="range" data-nudge="${escapeHtml(r.key)}" min="${range[0]}" max="${range[1]}" step="${(range[1] - range[0]) / 200}" value="${factor}">
    <span class="inf-value${group ? " changed" : ""}">${shown}</span>
  </div>`;
}

function upstreamCount(app: PaperApp, item: Item): number {
  return upstreamConstants(app, item).length;
}

function upstreamConstants(app: PaperApp, item: Item) {
  return [...upstream(app, itemVariables(app, item))].filter((k) => {
    const role = app.sem.vars.get(k)?.role;
    return role && ["fitted", "literature", "data-derived", "assumption", "expert", "calibrated", "constant"].includes(role);
  });
}

function itemRuns(item: Item): number {
  return item.kind === "figure" ? item.runs.length : item.kind === "row" ? 2 : item.runs.length;
}

// ---------- How the published figure was made ----------

function madeSection(figure: Figure): string {
  const links = figure.made.figure
    ? `<ul class="links">
        <li><a href="/files/${FIGURES_DIR}/${encodeURIComponent(figure.made.figure)}" target="_blank">${escapeHtml(figure.made.figure)}</a> <span class="muted">the published figure, as rendered by the authors</span></li>
        <li><a href="${sourceLink(NOTEBOOK, undefined, figure.made.notebookFind)}" target="_blank">Plotting code</a> <span class="muted">in ${escapeHtml(NOTEBOOK.split("/").pop()!)}</span></li>
      </ul>`
    : "";
  return `<section>
    <h2>How the published figure was made</h2>
    ${links}
    <ul class="caveats">${figure.caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
  </section>`;
}

// ---------- Live changes ----------

function editsBar(app: PaperApp): string {
  if (!app.editGroups.size) return "";
  return `<div class="edits-bar">Live changes: ${[...app.editGroups.values()].map((g) => `<b>${escapeHtml(g.label)}</b>`).join(", ")}
    <button data-clear>Reset to the published model</button></div>`;
}

// Attached once; the panel's content is replaced on every selection.
export function wireDetail(el: HTMLElement, app: PaperApp) {
  el.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const select = target.closest<HTMLElement>("[data-select]");
    if (select) {
      const [id, sub] = select.dataset.select!.split("/");
      const item = [...FIGURES, ...TABLE_ROWS, ...CLAIMS].find((i) => i.id === id);
      if (item) app.actions.select({ item, sub });
    }
    if (target.closest("[data-clear]")) app.actions.clearEdits();
    const rank = target.closest<HTMLElement>("[data-rank]");
    if (rank && app.selection) {
      const item = app.selection.item;
      rank.setAttribute("disabled", "");
      const progress = el.querySelector<HTMLElement>("[data-progress]");
      rankInfluence(app, item, (done, total) => {
        if (progress) progress.textContent = `${done} of ${total}…`;
      }).then(() => {
        if (app.selection?.item === item) updateLive(el, app);
      });
    }
  });
  el.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    const loop = input.dataset.loop;
    if (!loop || app.selection?.item.kind !== "figure") return;
    const spec = app.selection.item.loops!.find((l) => l.id === loop)!;
    const cells = new Map<number, number>();
    for (const key of spec.variables) for (const cell of app.sem.vars.get(key)?.cells ?? []) cells.set(cell, 1e-6);
    app.actions.setEdit(`loop:${loop}`, input.checked ? null : `${spec.title} loop off`, cells);
    const status = input.closest("label")?.querySelector(".muted");
    if (status) status.textContent = input.checked ? "on" : "off";
  });
}

function wireLive(el: HTMLElement, app: PaperApp) {
  el.querySelectorAll<HTMLInputElement>("[data-nudge]").forEach((input) => {
    input.oninput = () => {
      const item = app.selection?.item;
      const r = item && cachedInfluence(item)?.find((x) => x.key === input.dataset.nudge);
      if (!r) return;
      const factor = Number(input.value);
      const cells = new Map(r.cells.map((c, i) => [c, r.base[i] * factor]));
      app.actions.setEdit(`nudge:${r.key}`, Math.abs(factor - 1) < 0.005 ? null : `${r.name} ×${factor.toFixed(2)}`, cells);
    };
  });
}

// ---------- Small pieces ----------

function liveBlock(id: string, render: () => string): string {
  live.set(id, render);
  return `<div data-live="${id}"></div>`;
}

function variableChip(app: PaperApp, key: string, query = ""): string {
  const info = app.sem.vars.get(key);
  if (!info) return `<code>${escapeHtml(key)}</code>`;
  return `<a class="chip" style="--c:${LAYERS[info.layer].color}" href="${explorerLink(key, query)}" target="_blank" title="${escapeHtml(ROLES[info.role].label)}: open in the Explorer">${escapeHtml(info.name)}</a>`;
}

// Calibration variables are indexed by short codes (SimVar[InRM], DataVar[InRM]); this finds the
// model variable or the data series behind such a code.
function resolveTerm(app: PaperApp, term: string, wantData: boolean): string | null {
  const match = /^(simvar|datavar|datavarbase)\[(\w+)\]$/.exec(term);
  if (!match) return app.sem.vars.has(term) ? term : null;
  const element = match[2].toLowerCase();
  for (const info of app.sem.vars.values()) {
    const m = info.measuredAs.find((x) => x.element.toLowerCase() === element);
    if (m) return wantData || match[1] !== "simvar" ? m.data : info.key;
  }
  return null;
}

function statusPill(status: Status): string {
  return `<span class="pill ${status}">${STATUS_TEXT[status].mark} ${STATUS_TEXT[status].label}</span>`;
}

function interpolate(times: number[], points: Points): number[] {
  return times.map((t) => {
    const i = points.times.findIndex((p) => p >= t);
    if (i < 0) return NaN;
    if (points.times[i] === t) return points.values[i];
    if (i === 0) return NaN;
    const [t0, t1] = [points.times[i - 1], points.times[i]];
    return points.values[i - 1] + ((points.values[i] - points.values[i - 1]) * (t - t0)) / (t1 - t0);
  });
}

function trimText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
}

function formatPercent(value: number): string {
  return value < 0.001 ? "<0.1%" : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}
