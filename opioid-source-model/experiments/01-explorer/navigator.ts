// The left column: the question the model answers, the live answers, and every variable
// organised by the layer of the argument it belongs to.

import { formatNumber } from "../shared/chart.ts";
import { type App, escapeHtml } from "./context.ts";
import { ANSWERS } from "../shared/runs.ts";
import { LAYERS, ROLES, type Layer, type Role, type VarInfo } from "../shared/semantics.ts";

const LAYER_ORDER: Layer[] = ["theory", "quantities", "evidence", "measurement", "what-ifs", "settings"];

export function renderNavigator(root: HTMLElement, app: App) {
  root.innerHTML = `
    <h2>The question</h2>
    <div class="question">What will happen to opioid overdose deaths in the US through 2032, and which policies would help most?
      <div class="muted" style="margin-top:4px;font-size:11.5px">FDA SOURCE model (Lim et al. 2022), fitted to 1999–2020 data.</div>
    </div>
    <h2>The answers, live</h2>
    <div id="answers"></div>
    <h2>Everything in the model</h2>
    <input type="search" id="nav-search" placeholder="Search ${app.sem.vars.size} variables…">
    <div id="layers"></div>`;
  renderAnswers(root.querySelector("#answers")!, app);
  renderLayers(root.querySelector("#layers")!, app, "");
  root.querySelector<HTMLInputElement>("#nav-search")!.addEventListener("input", (e) => {
    renderLayers(root.querySelector("#layers")!, app, (e.target as HTMLInputElement).value);
  });
}

export function renderAnswers(root: HTMLElement, app: App) {
  const reference = app.runs.isReference(app.whatIf) ? null : { ...app.whatIf, noFentanyl: false, lever: "None", edits: new Map<number, number>() };
  root.innerHTML = ANSWERS.map((answer) => {
    const value = answer.value(app.runs, app.whatIf);
    const baseline = reference ? answer.value(app.runs, reference) : NaN;
    const delta = value - baseline;
    const deltaHtml =
      Number.isFinite(delta) && Math.abs(delta) > Math.abs(baseline) * 1e-4
        ? `<span class="delta ${delta > 0 === answer.higherIsBetter ? "better" : "worse"}">${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))}</span>`
        : "";
    return `<div class="answer" data-key="${escapeHtml(answer.variable)}">
      <div class="label">${answer.label}</div>
      <div><span class="value">${formatNumber(value)}</span>${deltaHtml}</div>
      <div class="how">${answer.how}</div>
    </div>`;
  }).join("");
  root.querySelectorAll<HTMLElement>("[data-key]").forEach((el) => el.addEventListener("click", () => app.actions.focus(el.dataset.key!)));
}

export function markActive(root: HTMLElement, key: string) {
  root.querySelectorAll<HTMLElement>(".var-link").forEach((el) => el.classList.toggle("active", el.dataset.key === key));
}

function renderLayers(root: HTMLElement, app: App, query: string) {
  const q = query.trim().toLowerCase();
  const matches = (v: VarInfo) => !q || v.name.toLowerCase().includes(q) || v.modelName.toLowerCase().includes(q);
  root.innerHTML = LAYER_ORDER.map((layer) => {
    const groups = groupsFor(app, layer)
      .map(([title, keys]) => [title, keys.filter((k) => matches(app.sem.vars.get(k)!))] as const)
      .filter(([, keys]) => keys.length);
    const total = groups.reduce((n, [, keys]) => n + keys.length, 0);
    if (!total) return "";
    const open = q ? " open" : layer === "theory" ? " open" : "";
    return `<details class="layer"${open}>
      <summary><span class="dot" style="background:${LAYERS[layer].color}"></span>${LAYERS[layer].title}<span class="count">${total}</span></summary>
      <div class="layer-desc">${LAYERS[layer].description}</div>
      ${groups
        .map(
          ([title, keys]) => `<details class="group"${q ? " open" : ""}>
            <summary>${escapeHtml(title)} <span class="count">${keys.length}</span></summary>
            ${keys.map((k) => `<a class="var-link${k === app.focus ? " active" : ""}" data-key="${escapeHtml(k)}">${escapeHtml(app.sem.vars.get(k)!.name)}</a>`).join("")}
          </details>`,
        )
        .join("")}
    </details>`;
  }).join("");
  root.querySelectorAll<HTMLElement>(".var-link").forEach((el) => el.addEventListener("click", () => app.actions.focus(el.dataset.key!)));
}

// Theory is grouped by the diagram view a variable appears in; the other layers by role.
function groupsFor(app: App, layer: Layer): [string, string[]][] {
  const inLayer = [...app.sem.vars.values()].filter((v) => v.layer === layer).sort((a, b) => a.name.localeCompare(b.name));
  if (layer === "theory") {
    const groups = new Map<string, string[]>();
    const skip = new Set(["Dashboard", "Data variables", "Calibration", "Output Variables"]);
    for (const v of inLayer) {
      const sector = v.sectors.find((s) => !skip.has(s)) ?? v.sectors[0] ?? "Not in any diagram";
      groups.set(sector, [...(groups.get(sector) ?? []), v.key]);
    }
    return [...groups].sort((a, b) => b[1].length - a[1].length);
  }
  const groups = new Map<Role, string[]>();
  for (const v of inLayer) groups.set(v.role, [...(groups.get(v.role) ?? []), v.key]);
  const roleOrder = Object.keys(ROLES) as Role[];
  return [...groups].sort((a, b) => roleOrder.indexOf(a[0]) - roleOrder.indexOf(b[0])).map(([role, keys]) => [ROLES[role].label, keys]);
}
