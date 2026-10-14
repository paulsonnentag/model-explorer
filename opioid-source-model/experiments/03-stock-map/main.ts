// Entry point: compiles the model, lays out every group of people by rule, finds the effects in the
// equations, and plays the run over time. Everything unfolds in place: loops on the left, stocks and
// flows on the map.

import type { Bundle } from "../core/inputs.ts";
import { compileModel } from "../core/compile.ts";
import { formatNumber } from "../shared/chart.ts";
import { rateFactors } from "../shared/factors.ts";
import { peopleFlows } from "../shared/flows.ts";
import { escapeHtml } from "../shared/html.ts";
import { findInputs, findLoops, knockoutCells, loopTitle } from "../shared/loops.ts";
import { isPlain, plainToggle, setPlain } from "../shared/plain.ts";
import { FUTURES, LEVERS, Runs, type WhatIf } from "../shared/runs.ts";
import { buildSemantics } from "../shared/semantics.ts";
import { peak } from "../shared/totals.ts";
import { PART_COLORS, type Hover, type MapApp, type Toggle, edgeSeries, partLabel, partsOf, rangeLabel, valueAt } from "./context.ts";
import { layoutStockMap } from "./layout.ts";
import { renderLoops, revealLoop, updateLoops } from "./loops-view.ts";
import { renderCards, renderMap, updateMap } from "./map.ts";

const FIRST_YEAR = 1999;
const LAST_YEAR = 2032;

let app: MapApp;
let playTimer = 0;

main();

async function main() {
  const bundle: Bundle = await (await fetch("/api/bundle")).json();
  const model = compileModel({ definitions: bundle.mdl.definitions, ranges: bundle.mdl.ranges, data: bundle.data });
  const sem = buildSemantics(bundle, model);
  const runs = new Runs(bundle, model);
  const whatIf: WhatIf = { future: "Base", lever: "None", strength: "20", noFentanyl: false, edits: new Map() };
  const loops = findLoops(sem);
  const inputs = findInputs(sem);
  const defaults = model.defaults();
  app = {
    bundle,
    model,
    sem,
    runs,
    whatIf,
    current: runs.current(whatIf),
    reference: null,
    layout: layoutStockMap(sem),
    loops,
    inputs,
    factors: new Map(peopleFlows(sem).map((f) => [f.key, rateFactors(sem, f.key, loops, inputs)])),
    fitted: new Map(loops.flatMap((l) => l.links.map((link) => [link.strength, defaults[sem.vars.get(link.strength)!.cells[0]]] as const))),
    loopsOff: new Set(),
    year: 2016,
    maxFlow: 1,
    plain: isPlain(),
    openLoops: new Set(),
    openFlows: new Set(),
    openStocks: new Set(),
    compactStocks: new Set(),
    hover: null,
    cardOffsets: new Map(),
    actions: { setYear, toggle, hover, switchLoop, restoreLoops },
  };
  // Widths use the base run's largest flow, so the same thickness means the same number in every scenario.
  app.maxFlow = Math.max(...app.layout.edges.map((e) => peak(edgeSeries(app, e))));
  renderControls();
  renderAll();
  byId("loading").classList.add("hidden");
}

function renderAll() {
  renderToolbar();
  renderLegend();
  renderMap(byId("map"), app);
  renderLoops(byId("loops"), app);
}

function toggle(kind: Toggle, id: string) {
  const flip = (set: Set<string>) => (set.has(id) ? set.delete(id) : set.add(id));
  if (kind === "loop") {
    flip(app.openLoops);
    renderLoops(byId("loops"), app);
    if (app.openLoops.has(id)) revealLoop(byId("loops"), id);
    return updateMap(byId("map"), app);
  }
  if (kind === "flow") {
    flip(app.openFlows);
    return renderCards(byId("map"), app);
  }
  if (kind === "stock") {
    flip(app.openStocks);
    return renderCards(byId("map"), app);
  }
  flip(app.compactStocks);
  renderMap(byId("map"), app);
}

function hover(next: Hover) {
  app.hover = next;
  updateMap(byId("map"), app);
}

function setYear(year: number) {
  app.year = year;
  byId<HTMLInputElement>("year").value = String(year);
  byId("year-label").textContent = String(Math.floor(year));
  updateMap(byId("map"), app);
  updateLoops(byId("loops"), app);
  renderToolbar();
}

function switchLoop(id: string) {
  if (app.loopsOff.has(id)) app.loopsOff.delete(id);
  else app.loopsOff.add(id);
  rerun();
}

function restoreLoops() {
  app.loopsOff.clear();
  rerun();
}

// Loop switches are the only edits this page makes, so the reference is the same what-if without them.
function rerun() {
  const edits = new Map<number, number>();
  for (const loop of app.loops) if (app.loopsOff.has(loop.id)) for (const [cell, value] of knockoutCells(app.sem, loop)) edits.set(cell, value);
  setWhatIf({ edits });
}

function setWhatIf(patch: Partial<WhatIf>) {
  app.whatIf = { ...app.whatIf, ...patch };
  app.current = app.runs.current(app.whatIf);
  app.reference = app.whatIf.edits.size ? app.runs.current({ ...app.whatIf, edits: new Map() }) : null;
  renderAll();
}

function togglePlain(plain: boolean) {
  setPlain(plain);
  app.plain = plain;
  renderAll();
}

function collapse(what: "stocks" | "flows" | "everything", expand = false) {
  if (what === "stocks" || what === "everything") {
    app.compactStocks = expand ? new Set() : new Set(app.layout.nodes.map((n) => n.key));
    if (!expand) app.openStocks.clear();
  }
  if (what === "flows" || what === "everything") app.openFlows = expand ? new Set(app.layout.edges.map((e) => e.id)) : new Set();
  if (what === "everything") app.openLoops.clear();
  renderAll();
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

function renderControls() {
  const option = (value: string, label: string, selected: boolean) => `<option value="${value}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  byId("controls").innerHTML = `
    <label>Future (2021–2032)<select id="ctl-future">${FUTURES.map((f) => option(f.name, f.label, f.name === app.whatIf.future)).join("")}</select></label>
    <label>Policy from 2022<select id="ctl-lever">${LEVERS.map((l) => option(l.name, l.label, l.name === app.whatIf.lever)).join("")}</select></label>
    <label class="check"><input type="checkbox" id="ctl-nofent"> History without illicit fentanyl</label>
    ${plainToggle()}
    <div class="year">
      <button id="play" title="Play through the run">▶</button>
      <input id="year" type="range" min="${FIRST_YEAR}" max="${LAST_YEAR}" step="0.25" value="${app.year}">
      <span id="year-label">${Math.floor(app.year)}</span>
    </div>`;
  byId("ctl-future").addEventListener("change", (e) => setWhatIf({ future: (e.target as HTMLSelectElement).value }));
  byId("ctl-lever").addEventListener("change", (e) => setWhatIf({ lever: (e.target as HTMLSelectElement).value }));
  byId("ctl-nofent").addEventListener("change", (e) => setWhatIf({ noFentanyl: (e.target as HTMLInputElement).checked }));
  byId("ctl-plain").addEventListener("change", (e) => togglePlain((e.target as HTMLInputElement).checked));
  byId("year").addEventListener("input", (e) => setYear(Number((e.target as HTMLInputElement).value)));
  byId("play").addEventListener("click", togglePlay);
}

function renderToolbar() {
  const total = app.layout.nodes.reduce((sum, n) => sum + valueAt(app, n.key), 0);
  const off = app.loops.filter((l) => app.loopsOff.has(l.id));
  byId("toolbar").innerHTML = `
    <span class="group">Stocks <button data-do="stocks">Collapse all</button><button data-do="stocks+">Expand all</button></span>
    <span class="group">Flows <button data-do="flows">Collapse all</button><button data-do="flows+">Expand all</button></span>
    <button data-do="everything">Collapse everything</button>
    ${off.length ? `<span class="banner">${off.length === 1 ? "1 loop" : `${off.length} loops`} off: ${escapeHtml(off.map((l) => loopTitle(l, app.plain)).join(", "))} · dashed = with loops on <a data-do="restore">Switch all back on</a></span>` : ""}
    <span class="summary">${formatNumber(total)} people tracked in ${Math.floor(app.year)}</span>`;
  byId("toolbar").onclick = (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-do]")?.dataset.do;
    if (!action) return;
    if (action === "restore") return restoreLoops();
    collapse(action.replace("+", "") as "stocks" | "flows" | "everything", action.endsWith("+"));
  };
}

function renderLegend() {
  const arrayed = app.layout.nodes.find((n) => partsOf(app, [n.key]));
  const parts = arrayed ? partsOf(app, [arrayed.key])! : [];
  const split = arrayed
    ? `<span class="sep"></span><span class="muted">Stacked by ${escapeHtml(rangeLabel(app, arrayed.key))}:</span>${parts.map((p, i) => `<span><i style="background:${PART_COLORS[i % PART_COLORS.length]}"></i>${escapeHtml(partLabel(app, p.label))}</span>`).join("")}`
    : "";
  const ghost = app.loopsOff.size ? `<span class="sep"></span><span><i class="dashed"></i>Run with loops on</span>` : "";
  byId("legend").innerHTML = `<span><i style="background:#9aa3ad"></i>Flow of people (thickness = people per year; click to unfold; hover or open a loop to colour the flows it changes)</span>${ghost}${split}`;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
