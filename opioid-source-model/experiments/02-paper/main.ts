// Entry point: the paper on the left, an exploded view of the selected figure, row or claim on the right.

import type { Bundle } from "../core/inputs.ts";
import { compileModel } from "../core/compile.ts";
import { Runs } from "../shared/runs.ts";
import { applyPlainNames, isPlain, plainToggle, setPlain } from "../shared/plain.ts";
import { buildSemantics } from "../shared/semantics.ts";
import type { PaperApp, Selection } from "./context.ts";
import { evaluateClaim, evaluateRow, publishedName } from "./context.ts";
import { renderDetail, updateLive, wireDetail } from "./detail.ts";
import type { RunKey } from "./items.ts";
import { CLAIMS, ITEMS, TABLE_ROWS } from "./items.ts";
import { figureSeries } from "./influence.ts";
import { renderPaper, type PaperView } from "./pdf.ts";

let app: PaperApp;
let view: PaperView;
let pendingFrame = 0;

main();

async function main() {
  const bundle: Bundle = await (await fetch("/api/bundle")).json();
  const model = compileModel({ definitions: bundle.mdl.definitions, ranges: bundle.mdl.ranges, data: bundle.data });
  app = {
    bundle,
    model,
    sem: semanticsFor(bundle, model),
    runs: new Runs(bundle, model),
    cellIndex: new Map(model.cells.map((c, i) => [c.key, i])),
    selection: null,
    edits: new Map(),
    editGroups: new Map(),
    published: new Map(),
    actions: { select, setEdit, clearEdits, loadPublished },
  };
  wireDetail(byId("detail"), app);
  byId("plain-slot").innerHTML = plainToggle();
  byId("ctl-plain").addEventListener("change", (e) => togglePlain((e.target as HTMLInputElement).checked));
  view = await renderPaper(byId("paper"), select);
  markStatuses();
  byId("loading").classList.add("hidden");
  select(selectionFromHash(), true);
  window.addEventListener("hashchange", () => {
    const next = selectionFromHash();
    if (next?.item !== app.selection?.item || next?.sub !== app.selection?.sub) select(next, true);
  });
}

function select(selection: Selection | null, scroll = false) {
  app.selection = selection;
  const hash = selection ? `#${selection.item.id}${selection.sub ? `/${selection.sub}` : ""}` : "";
  if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname);
  view.highlight(selection);
  if (selection && scroll) view.scrollTo(selection.item);
  renderDetail(byId("detail"), app);
  if (selection?.item.kind === "figure") {
    const sim = figureSeries(selection.item).filter((s) => s.kind === "sim");
    loadPublished(selection.item.runs, [...new Set(sim.flatMap((s) => s.terms))]);
  }
}

function semanticsFor(bundle: Bundle, model: PaperApp["model"]): PaperApp["sem"] {
  const sem = buildSemantics(bundle, model);
  if (isPlain()) applyPlainNames(sem);
  return sem;
}

function togglePlain(on: boolean) {
  setPlain(on);
  app.sem = semanticsFor(app.bundle, app.model);
  renderDetail(byId("detail"), app);
}

function setEdit(id: string, label: string | null, cells: Map<number, number>) {
  if (label === null) app.editGroups.delete(id);
  else app.editGroups.set(id, { label, cells });
  app.edits = new Map([...app.editGroups.values()].flatMap((g) => [...g.cells]));
  cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => updateLive(byId("detail"), app));
}

function clearEdits() {
  app.editGroups.clear();
  app.edits = new Map();
  renderDetail(byId("detail"), app);
}

// Fetches Vensim's own results for these cells, so the rebuilt figure can be checked against them.
async function loadPublished(runs: RunKey[], cells: string[]) {
  let fetched = false;
  for (const run of runs) {
    const name = publishedName(app, run);
    if (!name) continue;
    const missing = cells.filter((c) => !app.published.has(`${name}|${c}`));
    if (!missing.length) continue;
    const response = await fetch(`/api/published/${encodeURIComponent(name)}?cells=${encodeURIComponent(missing.join("|"))}`);
    const { series } = (await response.json()) as { series?: Record<string, (number | null)[]> };
    for (const cell of missing) {
      const row = series?.[cell];
      app.published.set(`${name}|${cell}`, row ? Float64Array.from(row, (v) => (v === null ? NaN : v)) : null);
    }
    fetched = true;
  }
  if (fetched) updateLive(byId("detail"), app);
}

// Colours each claim and table row on the page by whether the published model reproduces it.
function markStatuses() {
  for (const claim of CLAIMS) view.setStatus(claim.id, evaluateClaim(app, claim, new Map()).status);
  for (const row of TABLE_ROWS) view.setStatus(row.id, evaluateRow(app, row, new Map()).status);
}

function selectionFromHash(): Selection | null {
  const [id, sub] = decodeURIComponent(location.hash.slice(1)).split("/");
  const item = ITEMS.find((i) => i.id === id);
  return item ? { item, sub } : null;
}

function byId(id: string): HTMLElement {
  return document.getElementById(id)!;
}
