// The inspector: what the focused variable means, where its value comes from, its live chart,
// its equation, and (for constants) controls to change it and re-run the model.

import { chart, formatNumber, type Line } from "../shared/chart.ts";
import {
  type App,
  DATA_COLOR,
  ELEMENT_COLORS,
  PUBLISHED_COLOR,
  REFERENCE_COLOR,
  constantValue,
  dataPointsFor,
  escapeHtml,
  isConstant,
  sourceLink,
  visibleCells,
} from "./context.ts";
import { plainDescription } from "../shared/plain.ts";
import { LAYERS, ROLES, TAGS, type VarInfo } from "../shared/semantics.ts";

const CHART_CELLS = 8;

export function renderInspector(root: HTMLElement, app: App) {
  const info = app.sem.vars.get(app.focus);
  if (!info) return;
  const layer = LAYERS[info.layer];
  root.innerHTML = `
    <span class="badge" style="background:${layer.color}">${layer.title} · ${ROLES[info.role].label}</span>
    <h1>${escapeHtml(info.name)}</h1>
    ${info.name !== info.modelName ? `<div class="model-name">In the model: ${escapeHtml(info.modelName)}</div>` : ""}
    ${info.units ? `<div class="muted">Units: ${escapeHtml(info.units)}</div>` : ""}
    <div class="role-desc">${ROLES[info.role].description}${fittedNote(app, info)}</div>
    ${info.name !== info.modelName && plainDescription(info.key) ? `<div class="plain-desc">${escapeHtml(plainDescription(info.key)!)}</div>` : ""}
    <div id="insp-chart"></div>
    ${isConstant(app, info.key) ? `<h3>Change it and re-run</h3><div class="editor" id="insp-editor">${editorRows(app, info)}</div>` : ""}
    <h3>Where it comes from</h3>
    ${provenance(app, info)}
    <h3>${info.definitions.some((d) => d.kind === "data") ? "Definition" : "Equation"}</h3>
    ${info.definitions.map((d) => equationHtml(app, info, d)).join("")}
    ${info.comment ? `<h3>Modelers' note</h3><div class="comment">${highlightTags(escapeHtml(info.comment))}</div>` : ""}
  `;
  updateInspectorChart(root, app);
  wireInspector(root, app);
}

export function updateInspectorChart(root: HTMLElement, app: App) {
  const target = root.querySelector<HTMLElement>("#insp-chart");
  const info = app.sem.vars.get(app.focus);
  if (!target || !info) return;
  if (isConstant(app, info.key)) {
    target.innerHTML = "";
    root.querySelectorAll<HTMLInputElement>("[data-edit-cell]").forEach((input) => {
      const cell = Number(input.dataset.editCell);
      if (document.activeElement !== input) input.value = String(constantValue(app, cell));
    });
    return;
  }
  const cells = visibleCells(app, info.key, CHART_CELLS);
  const single = cells.length === 1;
  const color = (i: number) => (single ? LAYERS[info.layer].color : ELEMENT_COLORS[i % ELEMENT_COLORS.length]);
  const lines: Line[] = [];
  if (app.reference) cells.forEach((c, i) => lines.push({ values: app.reference!.series(c), color: single ? REFERENCE_COLOR : color(i), dash: "4,3", width: 1.2 }));
  if (app.published) {
    for (const c of cells) {
      const series = app.published.series.get(app.model.cells[c].key);
      if (series) lines.push({ values: series.map((v) => (v === null ? NaN : v)), color: PUBLISHED_COLOR, dash: "1,3", width: 2 });
    }
  }
  cells.forEach((c, i) => lines.push({ values: app.current.series(c), color: color(i), width: 2 }));
  const points = dataPointsFor(app, info.key);
  const variable = app.model.variables.get(info.key)!;
  const elementLegend = single
    ? ""
    : cells.map((c, i) => `<span><i style="border-color:${color(i)}"></i>${escapeHtml(variable.elementLabels[variable.cells.indexOf(c)] ?? "")}</span>`).join("");
  const hiddenCount = info.cells.length - cells.length;
  const hasLine = cells.some((c) => app.current.series(c).some((v) => Math.abs(v) < 1e30));
  target.innerHTML = `
    ${chart({ times: app.current.times, lines, points, markers: chartMarkers(app), width: 396, height: 200 })}
    <div class="legend">
      ${hasLine ? elementLegend || `<span><i style="border-color:${color(0)}"></i>this run</span>` : ""}
      ${app.reference && hasLine ? `<span><i class="dashed" style="border-color:${REFERENCE_COLOR}"></i>same future, no changes</span>` : ""}
      ${app.published ? `<span><i class="dotted" style="border-color:${PUBLISHED_COLOR}"></i>Vensim's published run (${escapeHtml(app.published.name)})</span>` : ""}
      ${points.length ? `<span><i class="dots" style="background:${DATA_COLOR}"></i>observed data${points[0].label && points[0].label !== "data" ? `: ${escapeHtml(points[0].label)}` : ""}</span>` : ""}
      ${hiddenCount > 0 ? `<span>+${hiddenCount} more elements not shown</span>` : ""}
    </div>`;
}

function chartMarkers(app: App) {
  const value = (key: string) => {
    const cell = app.sem.vars.get(key)?.cells[0];
    return cell === undefined ? NaN : constantValue(app, cell);
  };
  return [
    { time: value("maxdatatime"), label: "data ends" },
    { time: value("policy activation time"), label: "policies start" },
  ].filter((m) => Number.isFinite(m.time));
}

function fittedNote(app: App, info: VarInfo): string {
  if (!info.fitted) return "";
  const { value, lower, upper } = info.fitted;
  const simulations = (app.bundle.fitStats.find((s) => s.startsWith("After")) ?? "")
    .replace("After", "after")
    .replace(/\d{4,}/, (n) => Number(n).toLocaleString("en-US"));
  const atBound = value <= lower || value >= upper ? " It ended at the edge of its allowed range, so the data pushed it as far as it was allowed to go." : "";
  return ` The fit chose <b>${formatNumber(value)}</b> within the allowed range ${formatNumber(lower)}–${formatNumber(upper)}${simulations ? `, ${escapeHtml(simulations)}` : ""}.${atBound}`;
}

function editorRows(app: App, info: VarInfo): string {
  const cells = visibleCells(app, info.key, 12);
  const variable = app.model.variables.get(info.key)!;
  const rows = cells
    .map((cell) => {
      const value = constantValue(app, cell);
      const [min, max] = sliderRange(info, value);
      const label = variable.elementLabels[variable.cells.indexOf(cell)] || "value";
      return `<div class="row">
        <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <input type="range" min="${min}" max="${max}" step="${(max - min) / 400}" value="${value}" data-edit-cell="${cell}">
        <input type="number" step="any" value="${value}" data-edit-cell="${cell}">
      </div>`;
    })
    .join("");
  const edited = info.cells.some((c) => app.whatIf.edits.has(c));
  return `${rows}<div class="note">Every chart re-runs the full model (${app.model.cells.length.toLocaleString()} cells, 1999–2032) as you drag.
    ${edited ? `<a data-reset="${escapeHtml(info.key)}">Reset to the published value</a>` : ""}</div>`;
}

function sliderRange(info: VarInfo, value: number): [number, number] {
  if (info.fitted) return [info.fitted.lower, info.fitted.upper];
  if (info.role === "lever") return [-1, 1];
  if (value === 0) return [0, 1];
  return value > 0 ? [0, value * 2] : [value * 2, 0];
}

function provenance(app: App, info: VarInfo): string {
  const items: string[] = [];
  const first = info.definitions[0];
  const groupNote = first.group ? ` in the <i>.${escapeHtml(first.group)}</i> group` : " in the model core";
  items.push(`Defined in <a href="${sourceLink(app.bundle.files.model, first.line)}" target="_blank">OSM_Master_CURRENT.mdl, line ${first.line}</a>${groupNote}.`);
  if (info.tags.length) items.push(`Source tags: ${info.tags.map((t) => `<span class="tag" title="${TAGS[t]}">${t}</span>${TAGS[t]}`).join(", ")}.`);
  if (info.sources.length) items.push(`Cited source: ${info.sources.map(escapeHtml).join("; ")}.`);
  const points = info.cells.map((c) => app.model.dataPoints(c)).find((p) => p);
  if (points) {
    items.push(
      `${points.times.length} observed values, ${Math.floor(points.times[0])}–${Math.floor(points.times.at(-1)!)}, from the binary data files (${app.bundle.files.dataFiles
        .map((f) => f.split("/").pop())
        .join(", ")}). The browser reads them from Vensim's published run <a href="${sourceLink(`Publication Figures & Results Summary/Raw Results/${app.bundle.dataSourceRun}.tab`)}" target="_blank">${app.bundle.dataSourceRun}.tab</a>, which stores data variables only at their data points.`,
    );
  }
  for (const s of groupSetBy(info)) items.push(s);
  for (const m of info.measuredAs) items.push(`Compared with observed data <a data-key="${escapeHtml(m.data)}">${escapeHtml(app.sem.vars.get(m.data)!.name)}</a> when fitting (series ${m.element.toUpperCase()}).`);
  for (const m of info.measures) items.push(`Used to check the model's <a data-key="${escapeHtml(m.model)}">${escapeHtml(app.sem.vars.get(m.model)!.name)}</a> when fitting (series ${m.element.toUpperCase()}).`);
  if (info.sectors.length) items.push(`Appears in the diagram views: ${info.sectors.map(escapeHtml).join(", ")}.`);
  return `<ul class="prov-list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

function groupSetBy(info: VarInfo): string[] {
  const byKind = new Map<string, typeof info.setBy>();
  for (const s of info.setBy) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
  const describe: Record<string, string> = {
    "base change": "Overridden for every published run by",
    "fitted value": "Its value comes from the fitting run, recorded in",
    future: "Changed by the future scenarios",
    lever: "Changed by the policy scenarios",
    counterfactual: "Changed by the counterfactual history",
    test: "Changed by the test runs",
  };
  return [...byKind].map(([kind, list]) => {
    const unique = list.filter((s, i) => list.findIndex((o) => o.file === s.file && o.target === s.target) === i);
    const shown = unique.slice(0, 8).map((s) => `<a href="${sourceLink(s.file, undefined, s.target)}" target="_blank">${escapeHtml(s.file.split("/").pop()!)}</a> (${formatNumber(s.value)})`);
    const more = unique.length > 8 ? ` and ${unique.length - 8} more` : "";
    return `${describe[kind] ?? kind}: ${shown.join(", ")}${more}.`;
  });
}

function equationHtml(app: App, info: VarInfo, d: VarInfo["definitions"][number]): string {
  const lhs = `${escapeHtml(d.name)}${d.subscripts.length ? `[${d.subscripts.map(escapeHtml).join(",")}]` : ""}`;
  if (d.kind === "data" && !d.expression) return `<div class="equation"><span class="lhs">${lhs}</span>  ← data series (${d.dataMode})</div>`;
  const op = d.kind === "data" ? ":=" : "=";
  return `<div class="equation"><span class="lhs">${lhs}</span> ${op} ${linkNames(app, d.expression.replace(/\s+/g, " ").trim(), info.key)}</div>`;
}

// Turns every variable name in an equation into a link that focuses that variable.
function linkNames(app: App, expression: string, self: string): string {
  return expression.replace(/"[^"]+"|[A-Za-z_][A-Za-z0-9_$'&%.]*(?:\s+[A-Za-z0-9_$'&%.]+)*/g, (match) => {
    const key = match.replace(/"/g, "").toLowerCase().replace(/[_\s]+/g, " ").trim();
    if (key !== self && app.sem.vars.has(key)) return `<a data-key="${escapeHtml(key)}">${escapeHtml(match)}</a>`;
    return escapeHtml(match);
  });
}

function highlightTags(comment: string): string {
  return comment.replace(/\[([A-Z]{2,5}(?:\s*,\s*[A-Z]{2,5})*)\]/g, (m, tags: string) =>
    tags
      .split(",")
      .map((t) => t.trim())
      .some((t) => t in TAGS)
      ? `<span class="tag">${tags}</span>`
      : m,
  );
}

function wireInspector(root: HTMLElement, app: App) {
  root.querySelectorAll<HTMLElement>("[data-key]").forEach((el) => el.addEventListener("click", () => app.actions.focus(el.dataset.key!)));
  root.querySelectorAll<HTMLInputElement>("[data-edit-cell]").forEach((input) => {
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      const cell = Number(input.dataset.editCell);
      root.querySelectorAll<HTMLInputElement>(`[data-edit-cell="${cell}"]`).forEach((other) => {
        if (other !== input) other.value = String(value);
      });
      app.actions.edit(cell, value);
    });
  });
  root.querySelectorAll<HTMLElement>("[data-reset]").forEach((el) =>
    el.addEventListener("click", () => {
      const info = app.sem.vars.get(el.dataset.reset!)!;
      for (const cell of info.cells) app.actions.edit(cell, null);
      renderInspector(root, app);
    }),
  );
}
