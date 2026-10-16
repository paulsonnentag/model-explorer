// The trail: open panels side by side, left to right, with the menu after the last one. The stock and
// flow map and the loops are experiment 03's panels; the rest are the review's own.

import { updateLive } from "../03-stock-map/context.ts";
import { loopPanel, loopsPanel } from "../03-stock-map/loops-view.ts";
import { mapPanel } from "../03-stock-map/map.ts";
import { escapeHtml } from "../shared/html.ts";
import type { PanelView, ReviewApp } from "./app.ts";
import { changePanel, changesPanel } from "./changes.ts";
import { filePanel } from "./file-view.ts";
import { resultsPanel } from "./results.ts";

const VIEWS: Record<string, PanelView> = {
  changes: changesPanel,
  change: changePanel,
  results: resultsPanel,
  map: mapPanel,
  loops: loopsPanel,
  loop: loopPanel,
  source: filePanel,
};

export function renderTrail(root: HTMLElement, app: ReviewApp) {
  const existing = new Map([...root.querySelectorAll<HTMLElement>(":scope > section.panel")].map((el) => [el.dataset.panel!, el]));
  for (const [key, el] of existing) if (!app.panels.includes(key)) el.remove();
  let previous: Element | null = null;
  for (const key of app.panels) {
    const el = existing.get(key) ?? createPanel(app, key);
    if (el.previousElementSibling !== previous || !el.isConnected) {
      const body = el.querySelector<HTMLElement>(".body")!;
      const scroll = [body.scrollTop, body.scrollLeft];
      root.insertBefore(el, previous ? previous.nextSibling : root.firstChild);
      [body.scrollTop, body.scrollLeft] = scroll;
    }
    if (!existing.has(key)) draw(el, app, key);
    previous = el;
  }
  const menu = root.querySelector<HTMLElement>(":scope > nav.menu") ?? root.appendChild(document.createElement("nav"));
  menu.className = "menu";
  menu.innerHTML = menuHtml(app);
  menu.hidden = !menu.innerHTML;
  root.appendChild(menu);
}

// Redraws every open panel, keeping where each was scrolled to: after switching to another change.
export function redrawTrail(root: HTMLElement, app: ReviewApp) {
  for (const key of app.panels) redrawPanel(root, app, key);
  renderTrail(root, app);
}

export function redrawPanel(root: HTMLElement, app: ReviewApp, key: string) {
  const el = root.querySelector<HTMLElement>(`:scope > section.panel[data-panel="${CSS.escape(key)}"]`);
  if (el) draw(el, app, key);
}

export function updateTrail(root: HTMLElement, app: ReviewApp) {
  updateLive(root, app);
  for (const key of app.panels) {
    const { kind, id } = parseKey(key);
    const body = panelBody(root, key);
    if (body) VIEWS[kind].update?.(body, app, id);
  }
}

export function focusPanel(root: HTMLElement, app: ReviewApp, key: string, spec: string | undefined) {
  const el = root.querySelector<HTMLElement>(`:scope > section.panel[data-panel="${CSS.escape(key)}"]`);
  if (!el) return;
  el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  const { kind, id } = parseKey(key);
  if (spec) VIEWS[kind].focus?.(panelBody(root, key)!, app, id, spec);
}

export function panelBody(root: HTMLElement, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`:scope > section.panel[data-panel="${CSS.escape(key)}"] > .body`);
}

export function parseKey(key: string): { kind: string; id: string } {
  const at = key.indexOf(":");
  return at < 0 ? { kind: key, id: "" } : { kind: key.slice(0, at), id: key.slice(at + 1) };
}

export function isPanelKind(kind: string): boolean {
  return kind in VIEWS;
}

function createPanel(app: ReviewApp, key: string): HTMLElement {
  const { kind } = parseKey(key);
  const el = document.createElement("section");
  el.className = `panel panel-${kind}`;
  el.dataset.panel = key;
  el.style.width = `${VIEWS[kind].width(app)}px`;
  el.innerHTML = `<header></header><div class="body"></div><footer></footer>`;
  return el;
}

function draw(el: HTMLElement, app: ReviewApp, key: string) {
  const { kind, id } = parseKey(key);
  const view = VIEWS[kind];
  el.querySelector("header")!.innerHTML = `<span class="kind">${escapeHtml(view.kind(app, id))}</span><b>${escapeHtml(view.title(app, id))}</b><button data-close="${escapeHtml(key)}" title="Close">×</button>`;
  const body = el.querySelector<HTMLElement>(".body")!;
  const scroll = [body.scrollTop, body.scrollLeft];
  view.render(body, app, id);
  [body.scrollTop, body.scrollLeft] = scroll;
  const source = view.source?.(app, id) ?? "";
  const footer = el.querySelector("footer")!;
  footer.innerHTML = source ? `<span class="muted">From</span> ${source}` : "";
  footer.hidden = !source;
  updateLive(el, app);
}

// What the change does in the model; the raw diff is the text alone, as git shows it.
function menuHtml(app: ReviewApp): string {
  if (app.diffView === "raw") return "";
  const entry = (spec: string, label: string, hint: string) =>
    `<a class="${app.panels.includes(spec) ? "open" : ""}" data-open="${escapeHtml(spec)}"><b>${escapeHtml(label)}</b><small>${escapeHtml(hint)}</small></a>`;
  return `<h3>What it does</h3>
    ${entry("map", "Stock and flow model", "before and after, on the map")}
    ${entry("loops", "Feedback loops", "the effects on each flow")}
    ${entry("results", "Results", "the runs before and after")}`;
}
