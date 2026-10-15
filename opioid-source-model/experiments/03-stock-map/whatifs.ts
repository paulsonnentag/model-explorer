// Every alternative run the authors defined, each one a file in opioid-model/what-ifs/ that overrides a
// few constants: a future, the history without fentanyl, and a policy from 2022 at 10, 20 or 50%.
// Choosing one runs the whole trail in that state; a row unfolds into the lines of its file.

import { parseCellName } from "../core/compile.ts";
import { escapeHtml } from "../shared/html.ts";
import { FUTURES, LEVERS, type WhatIf } from "../shared/runs.ts";
import { type MapApp, sourceLink } from "./context.ts";
import { alternativeWhatIf } from "./findings.ts";
import type { PanelView } from "./trail.ts";

const STRENGTHS: WhatIf["strength"][] = ["10", "20", "50"];

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
      ${file ? `<button class="fold" data-fold="${escapeHtml(id)}" title="What this file changes">${file.overrides.length} line${file.overrides.length === 1 ? "" : "s"} ${open ? "▾" : "▸"}</button>` : ""}
    </div>
    ${file && open ? `<div class="cin"><a class="src" data-open="source:${escapeHtml(file.file)}">${escapeHtml(file.file)}</a>${file.overrides.map((o) => override(app, o.target, o.value)).join("")}</div>` : ""}
  </div>`;
}

function override(app: MapApp, target: string, value: number): string {
  const key = parseCellName(target).variable;
  return `<div class="ov" data-hover="var:${escapeHtml(key)}" data-var="${escapeHtml(key)}"><span>${escapeHtml(target)}</span><b>= ${value}</b>${sourceLink(app, key)}</div>`;
}

function matches(app: MapApp, id: string, alt: Parameters<typeof alternativeWhatIf>[0]): boolean {
  const w = alternativeWhatIf(alt);
  const [group, name] = id.split(":");
  if (group === "future") return name !== "Base" && w.future === name;
  if (group === "history") return name === "NoFentHist" && w.noFentanyl;
  return name !== "None" && w.lever === name && app.runs.leverFile(w) !== null;
}
