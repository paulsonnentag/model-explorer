// Entry point: compiles the model from opioid-model/ and lays out the trail. Panels open left to right
// from the menu, or from links inside other panels; all of them show the same run of the model, and
// whatever the pointer is over lights up on the map.

import { compileModel } from "../core/compile.ts";
import type { ModelFolder } from "../core/model-folder.ts";
import { rateFactors } from "../shared/factors.ts";
import { peopleFlows } from "../shared/flows.ts";
import { escapeHtml } from "../shared/html.ts";
import { findInputs, findLoops } from "../shared/loops.ts";
import { isPlain, plainToggle, setPlain } from "../shared/plain.ts";
import { FUTURES, LEVERS, Runs, type WhatIf } from "../shared/runs.ts";
import { buildSemantics } from "../shared/semantics.ts";
import { peak } from "../shared/totals.ts";
import { type Hover, type MapApp, type Toggle, bindHover, edgeSeries } from "./context.ts";
import { parseFinding } from "./finding-file.ts";
import { alternativeWhatIf, findingOf } from "./findings.ts";
import { layoutStockMap } from "./layout.ts";
import { mapCanvas, renderCards, renderMap, updateMap } from "./map.ts";
import { focusPanel, isPanelKind, panelBody, parseKey, redrawPanel, refreshTrail, renderTrail, updateTrail } from "./trail.ts";

const FIRST_YEAR = 1999;
const LAST_YEAR = 2032;
const FITTED: WhatIf = { future: "Base", lever: "None", strength: "20", noFentanyl: false, edits: new Map() };

let app: MapApp;
let playTimer = 0;

main();

async function main() {
  const bundle: ModelFolder = await (await fetch("/api/model")).json();
  const model = compileModel({ definitions: bundle.mdl.definitions, ranges: bundle.mdl.ranges, data: bundle.data });
  const sem = buildSemantics(bundle, model);
  const runs = new Runs(bundle, model);
  const loops = findLoops(sem);
  const inputs = findInputs(sem);
  const defaults = model.defaults();
  const lines = new Map<string, number>();
  for (const d of bundle.mdl.definitions) if (!lines.has(d.key)) lines.set(d.key, d.line);
  app = {
    bundle,
    findings: bundle.findings.map((f, i) => parseFinding(f.file, f.text, i + 1)),
    panels: [],
    focus: new Map(),
    lines,
    model,
    sem,
    runs,
    whatIf: FITTED,
    current: runs.current(FITTED),
    reference: null,
    layout: layoutStockMap(sem),
    loops,
    inputs,
    factors: new Map(peopleFlows(sem).map((f) => [f.key, rateFactors(sem, f.key, loops, inputs)])),
    fitted: new Map(loops.flatMap((l) => l.links.map((link) => [link.strength, defaults[sem.vars.get(link.strength)!.cells[0]]] as const))),
    year: 2016,
    maxFlow: 1,
    plain: isPlain(),
    openLoops: new Set(),
    openFlows: new Set(),
    openStocks: new Set(),
    compactStocks: new Set(),
    hover: null,
    alternative: null,
    cardOffsets: new Map(),
    actions: { setYear, toggle, hover, setWhatIf: (patch) => setWhatIf(patch), open, close, applyAlternative },
  };
  // Widths use the base run's largest flow, so the same thickness means the same number in every scenario.
  app.maxFlow = Math.max(...app.layout.edges.map((e) => peak(edgeSeries(app, e))));
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
  renderTrail(root, app);
  byId("loading").classList.add("hidden");
}

// Puts the panel right after the one the link is in, moving it there if it is already open elsewhere;
// links from the menu or the header open at the end.
function open(spec: string, from?: string) {
  const at = spec.indexOf(">");
  const key = at < 0 ? spec : spec.slice(0, at);
  const focus = at < 0 ? undefined : spec.slice(at + 1);
  if (!isPanelKind(parseKey(key).kind)) return;
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

// Open loops paint their arrows on the map, and the list of loops marks which are open.
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

// Any change made by hand leaves the finding's run; while one is applied, the dashed comparison is the
// finding's first run.
function setWhatIf(patch: Partial<WhatIf>, fromFinding = false) {
  if (!fromFinding) app.alternative = null;
  app.whatIf = { ...app.whatIf, ...patch };
  app.current = app.runs.current(app.whatIf);
  const active = activeAlternative();
  app.reference = active && active.index > 0 ? app.runs.current(alternativeWhatIf(active.finding.runs[0])) : null;
  refreshTrail(trail(), app);
  renderRunning();
}

function applyAlternative(findingId: string, alternativeId: string) {
  const finding = findingOf(app, findingId);
  app.alternative = `${findingId}:${alternativeId}`;
  setWhatIf(alternativeWhatIf(finding.runs.find((a) => a.id === alternativeId)!), true);
}

function activeAlternative() {
  if (!app.alternative) return null;
  const [findingId, alternativeId] = app.alternative.split(":");
  const finding = findingOf(app, findingId);
  const index = finding.runs.findIndex((a) => a.id === alternativeId);
  return { finding, alternative: finding.runs[index], index };
}

function renderHeader() {
  byId("controls").innerHTML = `
    ${plainToggle()}
    <div class="year">
      <button id="play" title="Play through the run">▶</button>
      <input id="year" type="range" min="${FIRST_YEAR}" max="${LAST_YEAR}" step="0.25" value="${app.year}">
      <span id="year-label">${Math.floor(app.year)}</span>
    </div>`;
  byId("ctl-plain").addEventListener("change", (e) => togglePlain((e.target as HTMLInputElement).checked));
  byId("year").addEventListener("input", (e) => setYear(Number((e.target as HTMLInputElement).value)));
  byId("play").addEventListener("click", togglePlay);
  byId("running").addEventListener("click", (e) => {
    const target = e.target as Element;
    if (target.closest("[data-reset]")) setWhatIf(FITTED);
    else if (target.closest("[data-whatifs]")) open("whatifs");
  });
  renderRunning();
}

// What the whole trail is showing: the run, and what the dashed lines compare it with.
function renderRunning() {
  const w = app.whatIf;
  const parts = [FUTURES.find((f) => f.name === w.future)?.label ?? w.future];
  if (w.noFentanyl) parts.push("history without fentanyl");
  if (w.lever !== "None") parts.push(`${LEVERS.find((l) => l.name === w.lever)?.label ?? w.lever}${app.runs.hasStrengths(w.lever) ? ` (${w.strength}%)` : ""}`);
  const active = activeAlternative();
  const from = active ? `Finding ${active.finding.number}: ${active.alternative.label}` : "";
  const dashed = active && active.index > 0 ? ` · dashed = ${active.finding.runs[0].label.toLowerCase()}` : "";
  const fitted = app.runs.isReference(w) && w.future === "Base";
  byId("running").innerHTML = `<span class="muted">Running</span> <a data-whatifs title="Open the what-ifs">${escapeHtml(from || parts.join(" · "))}</a>${escapeHtml(dashed)}${fitted ? "" : ` <button data-reset>Back to the fitted run</button>`}`;
}

function togglePlain(plain: boolean) {
  setPlain(plain);
  app.plain = plain;
  refreshTrail(trail(), app);
}

function togglePlay() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = 0;
  } else {
    if (app.year >= LAST_YEAR) setYear(FIRST_YEAR);
    playTimer = window.setInterval(() => {
      const next = Math.min(LAST_YEAR, app.year + 0.25);
      if (next >= LAST_YEAR) togglePlay();
      setYear(next);
    }, 80);
  }
  byId("play").textContent = playTimer ? "❚❚" : "▶";
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
