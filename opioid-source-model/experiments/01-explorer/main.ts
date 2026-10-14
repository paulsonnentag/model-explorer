// Entry point: loads the model bundle, compiles the model in the browser, and wires the views together.

import type { Bundle } from "../core/inputs.ts";
import { compileModel } from "../core/compile.ts";
import type { App } from "./context.ts";
import { escapeHtml } from "./context.ts";
import { renderDiagram, renderGraphBar, syncYearControls, updateDiagramValues, viewContains } from "./diagram.ts";
import { renderGraph, renderRoots } from "./graph.ts";
import { renderInspector, updateInspectorChart } from "./inspector.ts";
import { markActive, renderAnswers, renderNavigator } from "./navigator.ts";
import { renderPipes } from "./pipes.ts";
import { FUTURES, LEVERS, Runs, type WhatIf } from "../shared/runs.ts";
import { applyPlainNames, isPlain, plainToggle, setPlain } from "../shared/plain.ts";
import { buildSemantics } from "../shared/semantics.ts";

const DEFAULT_FOCUS = "total overdose deaths";
const publishedCache = new Map<string, (number | null)[]>();
let app: App;
let pendingFrame = 0;

main();

async function main() {
  const bundle: Bundle = await (await fetch("/api/bundle")).json();
  const started = performance.now();
  const model = compileModel({ definitions: bundle.mdl.definitions, ranges: bundle.mdl.ranges, data: bundle.data });
  const compileMs = performance.now() - started;
  const sem = semanticsFor(bundle, model);
  const runs = new Runs(bundle, model);
  const whatIf = whatIfFromUrl();
  const focus = decodeURIComponent(location.hash.replace(/^#/, "")) || DEFAULT_FOCUS;
  app = {
    bundle,
    model,
    sem,
    runs,
    whatIf,
    focus: sem.vars.has(focus) ? focus : DEFAULT_FOCUS,
    trail: [],
    openRoots: null,
    expandedColumns: new Set(),
    graphMode: new URLSearchParams(location.search).get("graph") === "diagram" ? "diagram" : "dependencies",
    diagramView: null,
    year: 2020,
    current: runs.current(whatIf),
    reference: null,
    published: null,
    actions: { focus: setFocus, edit, clearEdits, setWhatIf, toggleRoots, expandColumn, setGraphMode, setYear },
  };
  app.trail = [app.focus];
  for (const [target, value] of new URLSearchParams(location.search).getAll("set").map((s) => s.split("="))) {
    for (const cell of model.resolveOverride(target)) whatIf.edits.set(cell, Number(value));
  }
  console.info(`Compiled ${model.cells.length} cells in ${compileMs.toFixed(0)} ms`, model.problems);
  renderControls();
  renderNavigator(byId("nav"), app);
  refresh({ inspector: true });
  byId("loading").classList.add("hidden");
  window.addEventListener("hashchange", () => {
    const key = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (key && key !== app.focus && app.sem.vars.has(key)) setFocus(key);
  });
}

// Re-runs the model if the what-if changed (runs are cached) and redraws everything that depends on it.
function refresh({ inspector }: { inspector: boolean }) {
  app.current = app.runs.current(app.whatIf);
  app.reference = app.runs.isReference(app.whatIf) ? null : app.runs.reference(app.whatIf);
  app.published = publishedFor(app.runs.publishedName(app.whatIf));
  renderAnswers(byId("answers"), app);
  renderTrail();
  renderGraphPane();
  if (inspector) renderInspector(byId("inspector"), app);
  else updateInspectorChart(byId("inspector"), app);
  renderStatus();
  loadPublished();
}

// The middle pane: the dependency graph or the modelers' diagram, with the pipe strip above either.
function renderGraphPane() {
  const graph = byId("graph");
  graph.classList.toggle("diagram-mode", app.graphMode === "diagram");
  renderGraphBar(byId("graph-bar"), app);
  renderPipes(byId("pipes"), app);
  byId("roots").classList.toggle("hidden", app.graphMode === "diagram");
  if (app.graphMode === "diagram") renderDiagram(graph, app);
  else {
    renderRoots(byId("roots"), app);
    renderGraph(graph, app);
  }
}

function setFocus(key: string) {
  if (!app.sem.vars.has(key)) return;
  if (!viewContains(app, app.diagramView, key)) app.diagramView = null;
  app.focus = key;
  app.openRoots = null;
  const existing = app.trail.indexOf(key);
  app.trail = existing >= 0 ? app.trail.slice(0, existing + 1) : [...app.trail, key].slice(-8);
  if (location.hash.slice(1) !== encodeURIComponent(key)) history.replaceState(null, "", `#${encodeURIComponent(key)}`);
  markActive(byId("nav"), key);
  refresh({ inspector: true });
  byId("inspector").scrollTop = 0;
}

function edit(cell: number, value: number | null) {
  const edits = new Map(app.whatIf.edits);
  if (value === null) edits.delete(cell);
  else edits.set(cell, value);
  app.whatIf = { ...app.whatIf, edits };
  renderControls();
  cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => refresh({ inspector: false }));
}

function clearEdits() {
  app.whatIf = { ...app.whatIf, edits: new Map() };
  renderControls();
  refresh({ inspector: true });
}

function setWhatIf(patch: Partial<WhatIf>) {
  app.whatIf = { ...app.whatIf, ...patch };
  const params = new URLSearchParams();
  if (app.whatIf.future !== "Base") params.set("future", app.whatIf.future);
  if (app.whatIf.lever !== "None") params.set("lever", app.whatIf.lever);
  if (app.whatIf.strength !== "20") params.set("strength", app.whatIf.strength);
  if (app.whatIf.noFentanyl) params.set("nofent", "1");
  history.replaceState(null, "", `${params.size ? `?${params}` : location.pathname}${location.hash}`);
  renderControls();
  refresh({ inspector: true });
}

// ?future=Pos&lever=NxKits&strength=50&nofent=1&set=<variable>=<value> reproduces a what-if.
function whatIfFromUrl(): WhatIf {
  const params = new URLSearchParams(location.search);
  const strength = params.get("strength");
  return {
    future: FUTURES.some((f) => f.name === params.get("future")) ? params.get("future")! : "Base",
    lever: LEVERS.some((l) => l.name === params.get("lever")) ? params.get("lever")! : "None",
    strength: strength === "10" || strength === "50" ? strength : "20",
    noFentanyl: params.get("nofent") === "1",
    edits: new Map(),
  };
}

function toggleRoots(role: string) {
  app.openRoots = app.openRoots === role ? null : role;
  renderRoots(byId("roots"), app);
}

function expandColumn(id: string) {
  app.expandedColumns.add(`${app.focus}:${id}`);
  renderGraph(byId("graph"), app);
}

function setGraphMode(mode: App["graphMode"], view?: string) {
  app.graphMode = mode;
  if (view !== undefined) app.diagramView = view;
  const params = new URLSearchParams(location.search);
  if (mode === "diagram") params.set("graph", "diagram");
  else params.delete("graph");
  history.replaceState(null, "", `${params.size ? `?${params}` : location.pathname}${location.hash}`);
  renderGraphPane();
}

// Scrubbing time only changes values, so it updates the drawn diagram in place instead of redrawing.
function setYear(year: number) {
  app.year = year;
  syncYearControls(byId("graph-bar"), app);
  if (app.graphMode === "diagram") updateDiagramValues(byId("graph"), app);
  renderPipes(byId("pipes"), app);
}

function semanticsFor(bundle: Bundle, model: App["model"]): App["sem"] {
  const sem = buildSemantics(bundle, model);
  if (isPlain()) applyPlainNames(sem);
  return sem;
}

function togglePlain(on: boolean) {
  setPlain(on);
  app.sem = semanticsFor(app.bundle, app.model);
  renderControls();
  renderNavigator(byId("nav"), app);
  refresh({ inspector: true });
}

function renderControls() {
  const w = app.whatIf;
  const option = (value: string, label: string, selected: boolean) => `<option value="${value}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const editedNames = [...new Set([...w.edits.keys()].map((c) => app.sem.vars.get(app.model.cells[c].variable)?.name ?? ""))];
  byId("controls").innerHTML = `
    <label>Future (2021–2032)
      <select id="ctl-future">${FUTURES.map((f) => option(f.name, f.label, f.name === w.future)).join("")}</select>
    </label>
    <label>Policy from 2022
      <select id="ctl-lever">${LEVERS.map((l) => option(l.name, l.label, l.name === w.lever)).join("")}</select>
    </label>
    ${
      w.lever !== "None" && app.runs.hasStrengths(w.lever)
        ? `<label>Strength<select id="ctl-strength">${(["10", "20", "50"] as const).map((s) => option(s, `${s}%`, s === w.strength)).join("")}</select></label>`
        : ""
    }
    <label class="check"><input type="checkbox" id="ctl-nofent"${w.noFentanyl ? " checked" : ""}> History without illicit fentanyl</label>
    ${plainToggle()}
    ${editedNames.length ? `<span class="chip-edit">Edited: ${editedNames.map(escapeHtml).join(", ")}<button id="ctl-clear" title="Undo all edits">×</button></span>` : ""}`;
  byId("ctl-future").addEventListener("change", (e) => setWhatIf({ future: (e.target as HTMLSelectElement).value }));
  byId("ctl-lever").addEventListener("change", (e) => setWhatIf({ lever: (e.target as HTMLSelectElement).value }));
  document.getElementById("ctl-strength")?.addEventListener("change", (e) => setWhatIf({ strength: (e.target as HTMLSelectElement).value as WhatIf["strength"] }));
  byId("ctl-nofent").addEventListener("change", (e) => setWhatIf({ noFentanyl: (e.target as HTMLInputElement).checked }));
  document.getElementById("ctl-clear")?.addEventListener("click", clearEdits);
  byId("ctl-plain").addEventListener("change", (e) => togglePlain((e.target as HTMLInputElement).checked));
}

function renderTrail() {
  byId("trail").innerHTML = app.trail.map((k) => `<a data-key="${escapeHtml(k)}">${escapeHtml(app.sem.vars.get(k)?.name ?? k)}</a>`).join(" › ");
  byId("trail")
    .querySelectorAll<HTMLElement>("[data-key]")
    .forEach((el) => el.addEventListener("click", () => setFocus(el.dataset.key!)));
}

function renderStatus() {
  const published = app.runs.publishedName(app.whatIf);
  byId("status").innerHTML = `Model run in ${app.runs.lastRunMs.toFixed(0)} ms in your browser<br>${
    published ? `matches Vensim's published run <b>${published}</b>` : "a new run (no published equivalent)"
  }`;
}

function publishedFor(name: string | null): App["published"] {
  if (!name) return null;
  const series = new Map<string, (number | null)[]>();
  for (const cell of app.sem.vars.get(app.focus)?.cells ?? []) {
    const key = app.model.cells[cell].key;
    const cached = publishedCache.get(`${name}|${key}`);
    if (cached) series.set(key, cached);
  }
  return { name, series };
}

// Fetches Vensim's own results for the focused variable, so the chart can show both side by side.
async function loadPublished() {
  const name = app.runs.publishedName(app.whatIf);
  if (!name) return;
  const keys = (app.sem.vars.get(app.focus)?.cells ?? []).map((c) => app.model.cells[c].key).filter((k) => !publishedCache.has(`${name}|${k}`));
  if (!keys.length) return;
  const response = await fetch(`/api/published/${encodeURIComponent(name)}?cells=${encodeURIComponent(keys.join("|"))}`);
  const { series } = (await response.json()) as { series?: Record<string, (number | null)[]> };
  for (const key of keys) publishedCache.set(`${name}|${key}`, series?.[key] ?? []);
  if (app.runs.publishedName(app.whatIf) === name) {
    app.published = publishedFor(name);
    updateInspectorChart(byId("inspector"), app);
  }
}

function byId(id: string): HTMLElement {
  return document.getElementById(id)!;
}
