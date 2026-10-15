// The trail: open panels side by side, left to right, with the menu after the last one. Each panel
// says which file it is drawn from in its footer.

import { escapeHtml } from "../shared/html.ts";
import { type MapApp, updateLive } from "./context.ts";
import { findingPanel, findingsPanel } from "./findings.ts";
import { loopPanel, loopsPanel } from "./loops-view.ts";
import { mapPanel } from "./map.ts";
import { PAPERS, paperPanel } from "./paper.ts";
import { filesPanel, sourcePanel } from "./source.ts";
import { whatIfsPanel } from "./whatifs.ts";

export type PanelView = {
  // Drawn once; the others redraw whenever the run changes.
  static?: boolean;
  width: (app: MapApp) => number;
  kind: (app: MapApp, id: string) => string;
  title: (app: MapApp, id: string) => string;
  render: (body: HTMLElement, app: MapApp, id: string) => void;
  // Called as the year moves, after every `data-live` value in the trail has been refreshed.
  update?: (body: HTMLElement, app: MapApp, id: string) => void;
  focus?: (body: HTMLElement, app: MapApp, id: string, spec: string) => void;
  source?: (app: MapApp, id: string) => string;
};

const VIEWS: Record<string, PanelView> = {
  paper: paperPanel,
  findings: findingsPanel,
  finding: findingPanel,
  loops: loopsPanel,
  loop: loopPanel,
  map: mapPanel,
  whatifs: whatIfsPanel,
  source: sourcePanel,
  files: filesPanel,
};

export function renderTrail(root: HTMLElement, app: MapApp) {
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
  root.appendChild(menu);
}

// Redraws every panel that depends on the run, keeping where each was scrolled to.
export function refreshTrail(root: HTMLElement, app: MapApp) {
  for (const key of app.panels) {
    const { kind } = parseKey(key);
    if (VIEWS[kind].static) continue;
    const el = root.querySelector<HTMLElement>(`:scope > section.panel[data-panel="${CSS.escape(key)}"]`);
    if (el) draw(el, app, key);
  }
  renderTrail(root, app);
}

export function redrawPanel(root: HTMLElement, app: MapApp, key: string) {
  const el = root.querySelector<HTMLElement>(`:scope > section.panel[data-panel="${CSS.escape(key)}"]`);
  if (el) draw(el, app, key);
}

export function updateTrail(root: HTMLElement, app: MapApp) {
  updateLive(root, app);
  for (const key of app.panels) {
    const { kind, id } = parseKey(key);
    const body = panelBody(root, key);
    if (body) VIEWS[kind].update?.(body, app, id);
  }
}

export function focusPanel(root: HTMLElement, app: MapApp, key: string, spec: string | undefined) {
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

function createPanel(app: MapApp, key: string): HTMLElement {
  const { kind } = parseKey(key);
  const el = document.createElement("section");
  el.className = `panel panel-${kind}`;
  el.dataset.panel = key;
  el.style.width = `${VIEWS[kind].width(app)}px`;
  el.innerHTML = `<header></header><div class="body"></div><footer></footer>`;
  return el;
}

function draw(el: HTMLElement, app: MapApp, key: string) {
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

function menuHtml(app: MapApp): string {
  const entry = (spec: string, label: string, hint: string) =>
    `<a class="${app.panels.includes(spec) ? "open" : ""}" data-open="${escapeHtml(spec)}"><b>${escapeHtml(label)}</b><small>${escapeHtml(hint)}</small></a>`;
  const papers = app.bundle.papers.map((file) => entry(`paper:${file}`, PAPERS[file]?.short ?? file, PAPERS[file]?.journal ?? "")).join("");
  return `<h3>Papers</h3>${papers}
    <h3>The model</h3>
    ${entry("findings", "Findings", `${app.findings.length} claims from the papers`)}
    ${entry("loops", "Feedback loops", "the effects on each flow")}
    ${entry("map", "Stock and flow model", "every group of people")}
    ${entry("whatifs", "What-ifs", "futures, history and policies")}
    <h3>Files</h3>
    ${entry("files", "opioid-model/", "everything the model runs from")}`;
}
