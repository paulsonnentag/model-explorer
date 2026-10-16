// Every alternative run the authors defined, each one a file in opioid-model/what-ifs/ that overrides a
// few constants: a future, the history without fentanyl, and a policy from 2022 at 10, 20 or 50%.
// Choosing one runs the whole trail in that state; a row unfolds into the lines of its file.

import type { Override } from "../core/compile.ts";
import { escapeHtml } from "../shared/html.ts";
import { FUTURES, LEVERS, type WhatIf } from "../shared/runs.ts";
import { type MapApp, modelName, nameOf, sourceLink } from "./context.ts";
import { alternativeWhatIf } from "./findings.ts";
import type { PanelView } from "./panels.ts";

const STRENGTHS: WhatIf["strength"][] = ["10", "20", "50"];
const SHOWN_CELLS = 4;
const SHOWN_READERS = 4;

const unfolded = new Set<string>();

export const whatIfsPanel: PanelView = {
  width: () => 400,
  kind: () => "What-ifs",
  title: () => "Futures, history and policies",
  render(body, app) {
    const w = app.whatIf;
    const futures = FUTURES.map((f) => row(app, `future:${f.name}`, f.label, f.name, w.future === f.name));
    const history = [row(app, "history:actual", "Actual history", null, !w.noFentanyl), row(app, "history:NoFentHist", "History without illicit fentanyl", "NoFentHist", w.noFentanyl)];
    const policies = LEVERS.map((l) => row(app, `policy:${l.name}`, l.label, l.name === "None" ? null : (app.runs.leverFile({ ...w, lever: l.name }) ?? l.name), w.lever === l.name));
    body.innerHTML = `<p class="hint">Each is one of the authors' files, overriding a few constants of the fitted model. Pick one per group; unfold a row to see what it changes.</p>
      <h3>Future, 2021–2032</h3>${futures.join("")}
      <h3>History</h3>${history.join("")}
      <h3>Policy from 2022 <span class="strengths">${STRENGTHS.map((s) => `<button class="${w.strength === s ? "on" : ""}" data-strength="${s}">${s}%</button>`).join("")}</span></h3>${policies.join("")}`;
    body.onclick = (e) => {
      const target = e.target as Element;
      if (target.closest("[data-open]")) return;
      const strength = target.closest<HTMLElement>("[data-strength]");
      if (strength) return app.actions.setWhatIf({ strength: strength.dataset.strength as WhatIf["strength"] });
      const fold = target.closest<HTMLElement>("[data-fold]");
      if (fold) {
        const id = fold.dataset.fold!;
        if (unfolded.has(id)) unfolded.delete(id);
        else unfolded.add(id);
        return whatIfsPanel.render(body, app, "");
      }
      const pick = target.closest<HTMLElement>("[data-pick]");
      if (!pick) return;
      const [group, name] = pick.dataset.pick!.split(":");
      if (group === "future") app.actions.setWhatIf({ future: name });
      if (group === "history") app.actions.setWhatIf({ noFentanyl: name === "NoFentHist" });
      if (group === "policy") app.actions.setWhatIf({ lever: name });
    };
  },
  source: () => `<a data-open="files>what-ifs">what-ifs/</a>`,
};

// The file a what-if adds on top of the base run, if it adds one.
export function whatIfFile(app: MapApp, w: WhatIf): string | null {
  const name = w.lever !== "None" ? app.runs.leverFile(w) : w.noFentanyl ? "NoFentHist" : w.future;
  return app.bundle.scenarios.find((s) => s.name === name)?.file ?? null;
}

function row(app: MapApp, id: string, label: string, scenario: string | null, picked: boolean): string {
  const file = scenario ? app.bundle.scenarios.find((s) => s.name === scenario) : null;
  const open = unfolded.has(id);
  const users = app.findings.filter((f) => f.runs.some((alt) => matches(app, id, alt)));
  return `<div class="whatif${picked ? " picked" : ""}">
    <div class="pick" data-pick="${escapeHtml(id)}">
      <i class="radio"></i><span>${escapeHtml(label)}</span>
      ${users.map((f) => `<a class="chip" data-open="finding:${escapeHtml(f.id)}" title="${escapeHtml(f.title)}">Finding ${f.number}</a>`).join("")}
      ${file ? `<button class="fold" data-fold="${escapeHtml(id)}" title="What this changes in the model">diff ${open ? "▾" : "▸"}</button>` : ""}
    </div>
    ${file && open ? `<div class="cin"><a class="src" data-open="source:${escapeHtml(file.file)}">${escapeHtml(file.file)}</a><a class="src as-of-link" data-open="source:model.mdl@${escapeHtml(file.file)}">model as of this file</a>${diffHtml(app, id)}</div>` : ""}
  </div>`;
}

// What picking the row changes in the model as it runs: every constant that ends up with a new value,
// against the run it would replace, and the equations that read each one.
function diffHtml(app: MapApp, id: string): string {
  const { before, after, against } = comparison(app, id);
  const changes = changedConstants(app, before, after);
  if (!changes.size) return `<p class="diff-none">Nothing changes against ${escapeHtml(against)}: the run already uses these values.</p>`;
  const blocks = [...changes].map(([key, cells]) => {
    const name = modelName(app, key);
    const shown = cells.slice(0, SHOWN_CELLS);
    const more = cells.length > shown.length ? `<div class="ctx">… ${cells.length - shown.length} more ${escapeHtml(name)} values</div>` : "";
    const readers = (app.sem.vars.get(key)?.usedBy ?? []).slice(0, SHOWN_READERS);
    const reads = readers.length ? `<div class="ctx">read by ${readers.map((r) => `<a class="chip" data-open="source:model.mdl>var:${escapeHtml(r)}" data-hover="var:${escapeHtml(r)}" data-var="${escapeHtml(r)}">${escapeHtml(nameOf(app, r))}</a>`).join("")}</div>` : "";
    return `<div class="vdiff" data-hover="var:${escapeHtml(key)}" data-var="${escapeHtml(key)}">
      <div class="hunk">${sourceLink(app, key)} <span>${escapeHtml(name)}</span></div>
      ${shown.map((c) => `<div class="del">− ${escapeHtml(name + c.element)} = ${formatValue(c.from)}</div><div class="add">+ ${escapeHtml(name + c.element)} = ${formatValue(c.to)}</div>`).join("")}
      ${more}${reads}
    </div>`;
  });
  return `<p class="diff-head">${changes.size} constant${changes.size === 1 ? " changes" : "s change"} against ${escapeHtml(against)}</p>${blocks.join("")}`;
}

// The overrides of the run with the row picked, and of the run it replaces: no policy, the Base
// future (or no future file at all, for Base itself), or the actual history.
function comparison(app: MapApp, id: string): { before: Override[]; after: Override[]; against: string } {
  const w = app.whatIf;
  const [group, name] = id.split(":");
  if (group === "policy") return { before: app.runs.overrides({ ...w, lever: "None" }), after: app.runs.overrides({ ...w, lever: name }), against: "no policy change" };
  if (group === "history") return { before: app.runs.overrides({ ...w, noFentanyl: false }), after: app.runs.overrides({ ...w, noFentanyl: true }), against: "actual history" };
  const base = name === "Base";
  return { before: app.runs.overrides({ ...w, future: base ? "" : "Base" }), after: app.runs.overrides({ ...w, future: name }), against: base ? "the fitted model" : "trends continuing" };
}

function changedConstants(app: MapApp, before: Override[], after: Override[]): Map<string, { element: string; from: number; to: number }[]> {
  const [from, to] = [app.model.defaults(), app.model.defaults()];
  app.model.applyOverrides(from, before);
  app.model.applyOverrides(to, after);
  const changes = new Map<string, { element: string; from: number; to: number }[]>();
  app.model.cells.forEach((cell, i) => {
    if (cell.kind !== "const" || from[i] === to[i]) return;
    const element = cell.key.includes("[") ? cell.key.slice(cell.key.indexOf("[")) : "";
    changes.set(cell.variable, [...(changes.get(cell.variable) ?? []), { element, from: from[i], to: to[i] }]);
  });
  return changes;
}

function formatValue(value: number): string {
  return String(Number(value.toPrecision(6)));
}

function matches(app: MapApp, id: string, alt: Parameters<typeof alternativeWhatIf>[0]): boolean {
  const w = alternativeWhatIf(alt);
  const [group, name] = id.split(":");
  if (group === "future") return name !== "Base" && w.future === name;
  if (group === "history") return name === "NoFentHist" && w.noFentanyl;
  return name !== "None" && w.lever === name && app.runs.leverFile(w) !== null;
}
