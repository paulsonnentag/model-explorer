// Entry point: a review of one change to the model at a time, picked from opioid-model/changes/. Both
// versions of the model are compiled and run in the browser; the map, loops and formulas show the
// version after the change, with the version before it as the dashed comparison run.

import { bindHover, type Hover, type Toggle } from "../03-stock-map/context.ts";
import { layoutStockMap } from "../03-stock-map/layout.ts";
import { mapCanvas, renderCards, renderMap, updateMap } from "../03-stock-map/map.ts";
import type { RunResult } from "../core/compile.ts";
import type { ModelFolder } from "../core/model-folder.ts";
import { rateFactors } from "../shared/factors.ts";
import { peopleFlows } from "../shared/flows.ts";
import { escapeHtml } from "../shared/html.ts";
import { findInputs } from "../shared/loops.ts";
import { isPlain } from "../shared/plain.ts";
import { peak, totalSeries } from "../shared/totals.ts";
import type { ReviewApp } from "./app.ts";
import { type ChangeFile, parseChangeFile } from "./change-file.ts";
import { showFiles } from "./changes.ts";
import { effective } from "./diff-view.ts";
import { FITTED, type Review, alignedBaseRun, buildReview } from "./review.ts";
import { focusPanel, isPanelKind, panelBody, parseKey, redrawPanel, redrawTrail, renderTrail, updateTrail } from "./trail.ts";

const FIRST_YEAR = 1999;
const LAST_YEAR = 2032;
const ADDED = "#16a34a";
const EDITED = "#d97706";
// The panels a raw diff keeps: the text of the change, nothing it does in the model.
const RAW_PANELS = new Set(["changes", "change", "source"]);

let app: ReviewApp;
let folder: ModelFolder;
let modelText: string;
const reviews = new Map<string, Review>();

main();

async function main() {
  const [folderJson, changeFiles, model] = await Promise.all([
    fetch("../api/model.json").then((r) => r.json()),
    fetch("../api/changes.json").then((r) => r.json() as Promise<{ file: string; text: string }[]>),
    fetch("../model/model.mdl").then((r) => r.text()),
  ]);
  folder = folderJson;
  modelText = model;
  const texts = new Map(changeFiles.map((f) => [f.file, f.text]));
  const changes = changeFiles.filter((f) => f.file.endsWith(".md")).map((f) => parseChangeFile(f.file, f.text));
  const first = changes.find((c) => c.id === location.hash.slice(1)) ?? changes[0];
  const review = await reviewOf(first, texts);
  app = { ...mapState(review), changes, review, texts, diffView: "model", selectChange, setDiffView, panels: ["changes", `change:${first.id}`] } as ReviewApp;
  renderHeader();
  const root = trail();
  bindHover(root, app);
  root.addEventListener("click", (e) => {
    const target = e.target as Element;
    const closing = target.closest<HTMLElement>("[data-close]");
    if (closing) return close(closing.dataset.close!);
    const link = target.closest<HTMLElement>("[data-open]");
    if (link) {
      e.preventDefault();
      open(link.dataset.open!, link.closest<HTMLElement>("section.panel")?.dataset.panel);
    }
  });
  markChanges();
  renderTrail(root, app);
  byId("loading").classList.add("hidden");
}

async function reviewOf(change: ChangeFile, texts: Map<string, string>): Promise<Review> {
  if (!reviews.has(change.id)) reviews.set(change.id, await buildReview(folder, modelText, change, texts, (path) => fetch(`../model/${path}`).then((r) => r.text())));
  return reviews.get(change.id)!;
}

// What 03's map, cards and loops read, for the version after the change. Arrow widths are scaled to its
// largest flow.
function mapState(review: Review): Omit<ReviewApp, "changes" | "review" | "texts" | "diffView" | "selectChange" | "setDiffView" | "panels"> {
  const { head } = review;
  const layout = layoutStockMap(head.sem);
  const inputs = findInputs(head.sem);
  const current = head.runs.current(FITTED);
  const lines = new Map<string, number>();
  for (const d of head.mdl.definitions) if (!lines.has(d.key)) lines.set(d.key, d.line);
  return {
    bundle: head.bundle,
    findings: [],
    focus: app?.focus ?? new Map(),
    lines,
    model: head.model,
    sem: head.sem,
    runs: head.runs,
    whatIf: FITTED,
    current,
    reference: alignedBaseRun(review, review.base.runs.current(FITTED)),
    layout,
    loops: head.loops,
    inputs,
    factors: new Map(peopleFlows(head.sem).map((f) => [f.key, rateFactors(head.sem, f.key, head.loops, inputs)])),
    fitted: new Map(head.loops.flatMap((l) => l.links.map((link) => [link.strength, fittedValue(review, link.strength)] as const))),
    year: app?.year ?? 2025,
    maxFlow: Math.max(...layout.edges.map((e) => peak(edgeTotal(review, current, e.flows.map((f) => f.key))))),
    plain: isPlain(),
    openLoops: new Set<string>(),
    openFlows: new Set<string>(),
    openStocks: new Set<string>(),
    compactStocks: app?.compactStocks ?? new Set<string>(),
    hover: null,
    alternative: null,
    cardOffsets: new Map(),
    actions: { setYear, toggle, hover, setWhatIf: () => {}, open, close, applyAlternative: () => {} },
  };
}

// The estimate from calibration, so a change that zeroes a strength shows up in the runs rather than
// reading as "fitted to zero".
function fittedValue(review: Review, strength: string): number {
  const side = review.base.sem.vars.has(strength) ? review.base : review.head;
  return side.constants[side.sem.vars.get(strength)!.cells[0]];
}

function edgeTotal(review: Review, run: RunResult, flows: string[]): Float64Array {
  const out = new Float64Array(run.times.length);
  for (const flow of flows) totalSeries(review.head.model, review.head.sem, run, flow).forEach((v, i) => (out[i] += v));
  return out;
}

async function selectChange(id: string) {
  const change = app.changes.find((c) => c.id === id);
  if (!change || change.id === app.review.change.id) return;
  byId("loading").classList.remove("hidden");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const review = await reviewOf(change, app.texts);
  const panels = app.panels.map((k) => (k.startsWith("change:") ? `change:${id}` : k)).filter((k) => !k.startsWith("loop:") || review.head.loops.some((l) => `loop:${l.id}` === k));
  Object.assign(app, mapState(review), { review, panels });
  history.replaceState(null, "", `#${id}`);
  renderHeader();
  markChanges();
  redrawTrail(trail(), app);
  byId("loading").classList.add("hidden");
}

// Switches every change to the view, and shows it on the change that is open.
function setDiffView(view: ReviewApp["diffView"]) {
  app.diffView = view;
  showFiles(app.review.change.id);
  renderHeader();
  const key = `change:${app.review.change.id}`;
  if (view === "raw") app.panels = app.panels.filter((k) => RAW_PANELS.has(parseKey(k).kind));
  if (app.panels.includes(key)) redrawPanel(trail(), app, key);
  else app.panels.push(key);
  panelsChanged();
}

// Puts the panel right after the one the link is in, moving it there if it is already open elsewhere;
// opening another change switches the whole review to it.
async function open(spec: string, from?: string) {
  const at = spec.indexOf(">");
  const key = at < 0 ? spec : spec.slice(0, at);
  const focus = at < 0 ? undefined : spec.slice(at + 1);
  const { kind, id } = parseKey(key);
  if (!isPanelKind(kind)) return;
  if (kind === "change") await selectChange(id);
  if (focus) app.focus.set(key, focus);
  if (key !== from) place(key, from);
  focusPanel(trail(), app, key, focus);
}

function place(key: string, from: string | undefined) {
  const panels = app.panels.filter((k) => k !== key);
  panels.splice(from && panels.includes(from) ? panels.indexOf(from) + 1 : panels.length, 0, key);
  if (panels.join("\n") === app.panels.join("\n")) return;
  app.panels = panels;
  panelsChanged();
}

function close(key: string) {
  app.panels = app.panels.filter((k) => k !== key);
  app.focus.delete(key);
  panelsChanged();
}

function panelsChanged() {
  app.openLoops = new Set(app.panels.filter((k) => k.startsWith("loop:")).map((k) => parseKey(k).id));
  renderTrail(trail(), app);
  redrawPanel(trail(), app, "loops");
  withMap((canvas) => updateMap(canvas, app));
}

function toggle(kind: Toggle, id: string) {
  const flip = (set: Set<string>) => (set.has(id) ? set.delete(id) : set.add(id));
  if (kind === "compact") {
    flip(app.compactStocks);
    return withMap((canvas) => renderMap(canvas, app));
  }
  flip(kind === "flow" ? app.openFlows : app.openStocks);
  withMap((canvas) => renderCards(canvas, app));
}

function hover(next: Hover) {
  app.hover = next;
  withMap((canvas) => updateMap(canvas, app));
}

function setYear(year: number) {
  app.year = year;
  byId<HTMLInputElement>("year").value = String(year);
  byId("year-label").textContent = String(Math.floor(year));
  updateTrail(trail(), app);
}

// Hovering what the change touches colours it on the map: new arrows and boxes green, the ones it acts
// on amber. A stylesheet rather than classes, so the marks survive the map redrawing itself.
function markChanges() {
  const r = app.review;
  const edgeOf = (flow: string) => app.layout.edges.find((e) => e.flows.some((f) => f.key === flow))?.id;
  const added = new Set(r.definitions.filter((d) => d.kind === "added").map((d) => d.key));
  const acted = new Set(effective(app).flatMap((key) => r.actsOn.get(key)?.flows ?? []));
  const stocks = r.definitions.filter((d) => app.layout.nodes.some((n) => n.key === d.key)).map((d) => d.key);
  const rules = [
    ...[...acted]
      .map((f) => [edgeOf(f), added.has(f) ? ADDED : EDITED] as const)
      .filter(([id]) => id)
      .map(([id, color]) => `g.edge.hot[data-edge="${CSS.escape(id!)}"] .base { stroke: ${color} !important; } g.edge.hot[data-edge="${CSS.escape(id!)}"] .head { fill: ${color} !important; }`),
    ...stocks.map((k) => `g.node.hot[data-key="${CSS.escape(k)}"] .outline { stroke: ${added.has(k) ? ADDED : EDITED} !important; stroke-width: 3px !important; }`),
  ];
  let style = document.getElementById("change-marks");
  if (!style) document.head.append((style = Object.assign(document.createElement("style"), { id: "change-marks" })));
  style.textContent = rules.join("\n");
}

function renderHeader() {
  const change = app.review.change;
  byId("running").innerHTML = `<label class="picker"><span class="muted">Reviewing</span>
      <select id="change-picker">${app.changes.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === change.id ? " selected" : ""}>#${c.number} ${escapeHtml(c.title)}</option>`).join("")}</select></label>
    <label class="check"><input id="model-changes" type="checkbox"${app.diffView === "model" ? " checked" : ""}> Show model changes</label>`;
  byId<HTMLSelectElement>("change-picker").onchange = (e) => open(`change:${(e.target as HTMLSelectElement).value}`);
  byId<HTMLInputElement>("model-changes").onchange = (e) => setDiffView((e.target as HTMLInputElement).checked ? "model" : "raw");
  byId("controls").hidden = app.diffView === "raw";
  if (byId("year")) return;
  byId("controls").innerHTML = `<div class="year">
      <input id="year" type="range" min="${FIRST_YEAR}" max="${LAST_YEAR}" step="0.25" value="${app.year}">
      <span id="year-label">${Math.floor(app.year)}</span>
    </div>`;
  byId("year").addEventListener("input", (e) => setYear(Number((e.target as HTMLInputElement).value)));
}

function withMap(fn: (canvas: HTMLElement) => void) {
  const body = panelBody(trail(), "map");
  if (body) fn(mapCanvas(body));
}

function trail(): HTMLElement {
  return byId("trail");
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
