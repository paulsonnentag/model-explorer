// The panels every layout shows: what each kind draws, and the frame around it (a header with its
// title, the body, and a footer naming the file it is drawn from). Layouts decide where panels go; a
// panel is always a `section.panel[data-panel]` somewhere under the layout's root.

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
  // Called as the year moves, after every `data-live` value in the layout has been refreshed.
  update?: (body: HTMLElement, app: MapApp, id: string) => void;
  focus?: (body: HTMLElement, app: MapApp, id: string, spec: string) => void;
  source?: (app: MapApp, id: string) => string;
};

export const VIEWS: Record<string, PanelView> = {
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

export function createPanel(app: MapApp, key: string): HTMLElement {
  const { kind } = parseKey(key);
  const el = document.createElement("section");
  el.className = `panel panel-${kind}`;
  el.dataset.panel = key;
  el.innerHTML = `<header></header><div class="body"></div><footer></footer>`;
  drawPanel(el, app, key);
  return el;
}

export function drawPanel(el: HTMLElement, app: MapApp, key: string) {
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

// Redraws every panel that depends on the run, keeping where each was scrolled to.
export function refreshPanels(root: HTMLElement, app: MapApp) {
  for (const key of app.panels) {
    const el = panelEl(root, key);
    if (el && !VIEWS[parseKey(key).kind].static) drawPanel(el, app, key);
  }
  updateLive(root, app);
}

export function redrawPanel(root: HTMLElement, app: MapApp, key: string) {
  const el = panelEl(root, key);
  if (el) drawPanel(el, app, key);
}

export function updatePanels(root: HTMLElement, app: MapApp) {
  updateLive(root, app);
  for (const key of app.panels) {
    const { kind, id } = parseKey(key);
    const body = panelBody(root, key);
    if (body) VIEWS[kind].update?.(body, app, id);
  }
}

// Flashes the panel and shows what `spec` points at inside it.
export function focusInPanel(root: HTMLElement, app: MapApp, key: string, spec: string | undefined) {
  const el = panelEl(root, key);
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  const { kind, id } = parseKey(key);
  if (spec) VIEWS[kind].focus?.(panelBody(root, key)!, app, id, spec);
}

export function panelEl(root: HTMLElement, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`section.panel[data-panel="${CSS.escape(key)}"]`);
}

export function panelBody(root: HTMLElement, key: string): HTMLElement | null {
  return panelEl(root, key)?.querySelector<HTMLElement>(":scope > .body") ?? null;
}

export function parseKey(key: string): { kind: string; id: string } {
  const at = key.indexOf(":");
  return at < 0 ? { kind: key, id: "" } : { kind: key.slice(0, at), id: key.slice(at + 1) };
}

export function isPanelKind(kind: string): boolean {
  return kind in VIEWS;
}

// Everything that can be opened without following a link: the papers, the model's views, the files.
export function menuEntries(app: MapApp): { section: string; spec: string; label: string; hint: string }[] {
  return [
    ...app.bundle.papers.map((file) => ({ section: "Papers", spec: `paper:${file}`, label: PAPERS[file]?.short ?? file, hint: PAPERS[file]?.journal ?? "" })),
    { section: "The model", spec: "findings", label: "Findings", hint: `${app.findings.length} claims from the papers` },
    { section: "The model", spec: "loops", label: "Feedback loops", hint: "the effects on each flow" },
    { section: "The model", spec: "map", label: "Stock and flow model", hint: "every group of people" },
    { section: "The model", spec: "whatifs", label: "What-ifs", hint: "futures, history and policies" },
    { section: "Files", spec: "files", label: "opioid-model/", hint: "everything the model runs from" },
  ];
}

export function menuHtml(app: MapApp): string {
  let section = "";
  return menuEntries(app)
    .map((e) => {
      const heading = e.section !== section ? `<h3>${escapeHtml(e.section)}</h3>` : "";
      section = e.section;
      return `${heading}<a class="${app.panels.includes(e.spec) ? "open" : ""}" data-open="${escapeHtml(e.spec)}"><b>${escapeHtml(e.label)}</b><small>${escapeHtml(e.hint)}</small></a>`;
    })
    .join("");
}
