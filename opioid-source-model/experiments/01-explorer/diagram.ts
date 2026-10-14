// The modelers' own diagrams from the .mdl sketch, drawn where they placed things but running live:
// stocks fill like tanks, pipes are as thick as the flow through them, and dashes move in the
// direction people move. A year slider scrubs through the run.

import type { View } from "../core/mdl.ts";
import type { SketchLink, SketchObject } from "../core/sketch.ts";
import { formatNumber } from "../shared/chart.ts";
import { LAYERS } from "../shared/semantics.ts";
import { peak } from "../shared/totals.ts";
import { type App, escapeHtml, totalAt, totalSeries } from "./context.ts";

type Camera = { view: string; cx: number; cy: number; scale: number };

const PREFERRED_VIEW = "User stocks & flows";
const FIRST_YEAR = 1999;
const LAST_YEAR = 2032;
const MAX_PIPE = 16;

let camera: Camera | null = null;
let playTimer = 0;
let dragMoved = false;

export function renderGraphBar(bar: HTMLElement, app: App) {
  const view = app.graphMode === "diagram" ? chooseView(app) : null;
  const views = drawableViews(app);
  const contains = (v: View) => v.objects.some((o) => o.key === app.focus);
  bar.innerHTML = `
    <div class="tabs">
      <button data-mode="dependencies" class="${app.graphMode === "dependencies" ? "on" : ""}">Dependencies</button>
      <button data-mode="diagram" class="${app.graphMode === "diagram" ? "on" : ""}">Stock-and-flow diagram</button>
    </div>
    ${
      view
        ? `<label class="view-pick">Diagram <select id="diagram-view">${views
            .map((v) => `<option value="${escapeHtml(v.name)}"${v === view ? " selected" : ""}>${contains(v) ? "● " : ""}${escapeHtml(v.name)}</option>`)
            .join("")}</select></label>
          <button id="diagram-fit" title="Show the whole diagram">Fit</button>`
        : ""
    }
    <div class="year">
      <button id="year-play" title="Play through the run">${playTimer ? "❚❚" : "▶"}</button>
      <input id="year-slider" type="range" min="${FIRST_YEAR}" max="${LAST_YEAR}" step="0.25" value="${app.year}">
      <span id="year-label">${Math.floor(app.year)}</span>
    </div>`;
  bar.querySelectorAll<HTMLElement>("[data-mode]").forEach((el) => el.addEventListener("click", () => app.actions.setGraphMode(el.dataset.mode as App["graphMode"])));
  bar.querySelector<HTMLSelectElement>("#diagram-view")?.addEventListener("change", (e) => {
    camera = null;
    app.actions.setGraphMode("diagram", (e.target as HTMLSelectElement).value);
  });
  bar.querySelector("#diagram-fit")?.addEventListener("click", () => {
    const root = document.getElementById("graph")!;
    camera = fitCamera(chooseView(app), root);
    applyCamera(root);
  });
  bar.querySelector<HTMLInputElement>("#year-slider")!.addEventListener("input", (e) => app.actions.setYear(Number((e.target as HTMLInputElement).value)));
  bar.querySelector("#year-play")!.addEventListener("click", () => togglePlay(app));
}

export function syncYearControls(bar: HTMLElement, app: App) {
  const slider = bar.querySelector<HTMLInputElement>("#year-slider");
  if (slider && Number(slider.value) !== app.year) slider.value = String(app.year);
  const label = bar.querySelector("#year-label");
  if (label) label.textContent = String(Math.floor(app.year));
  const play = bar.querySelector("#year-play");
  if (play) play.textContent = playTimer ? "❚❚" : "▶";
}

export function renderDiagram(root: HTMLElement, app: App) {
  const view = chooseView(app);
  const byId = new Map(view.objects.map((o) => [o.id, o]));
  const focusObjects = view.objects.filter((o) => o.key === app.focus);
  const maxFlow = Math.max(1e-9, ...view.objects.filter((o) => o.kind === "valve" && o.key).map((o) => peak(totalSeries(app, o.key))));
  const links = view.links.map((l) => renderLink(app, l, byId)).join("");
  const objects = view.objects.map((o) => renderObject(app, o)).join("");
  const note = focusObjects.length
    ? ""
    : `<div class="diagram-note">${escapeHtml(app.sem.vars.get(app.focus)?.name ?? app.focus)} is not drawn in “${escapeHtml(view.name)}”${
        drawableViews(app).some((v) => v.objects.some((o) => o.key === app.focus)) ? ". Pick a view marked ● above." : ", or in any other diagram."
      }</div>`;
  root.innerHTML = `<svg class="diagram" data-max-flow="${maxFlow}">
    <defs>
      <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="#9aa3ad"/></marker>
      <marker id="pipehead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#5d93c9"/></marker>
    </defs>
    <g class="links">${links}</g><g class="objects">${objects}</g>
  </svg>${note}`;
  const target = focusObjects.find((o) => o.kind !== "flow") ?? focusObjects[0];
  if (!camera || camera.view !== view.name) camera = target ? { view: view.name, cx: target.x, cy: target.y, scale: 1 } : fitCamera(view, root);
  else if (target && !inViewport(root, target)) camera = { ...camera, cx: target.x, cy: target.y };
  applyCamera(root);
  updateDiagramValues(root, app);
  wireDiagram(root, app);
}

export function updateDiagramValues(root: HTMLElement, app: App) {
  const svg = root.querySelector<SVGSVGElement>("svg.diagram");
  if (!svg) return;
  const maxFlow = Number(svg.dataset.maxFlow);
  const cache = new Map<string, number>();
  const value = (key: string) => cache.get(key) ?? (cache.set(key, totalAt(app, key, app.year)), cache.get(key)!);
  svg.querySelectorAll<SVGRectElement>("[data-level]").forEach((rect) => {
    const fraction = Math.max(0, Math.min(1, value(rect.dataset.level!) / Number(rect.dataset.max)));
    const top = Number(rect.dataset.top);
    const height = Number(rect.dataset.height);
    rect.setAttribute("y", String(top + height * (1 - fraction)));
    rect.setAttribute("height", String(height * fraction));
  });
  svg.querySelectorAll<HTMLElement>("[data-value]").forEach((el) => (el.textContent = formatNumber(value(el.dataset.value!))));
  svg.querySelectorAll<SVGPathElement>("[data-flow]").forEach((path) => {
    const v = value(path.dataset.flow!);
    const share = Math.sqrt(Math.min(1, Math.abs(v) / maxFlow));
    if (path.classList.contains("pipe")) path.style.strokeWidth = String(2 + MAX_PIPE * share);
    else {
      path.style.opacity = Math.abs(v) < maxFlow * 1e-4 ? "0" : "1";
      path.style.animationDuration = `${(0.5 + 3.5 * (1 - share)).toFixed(2)}s`;
      path.style.animationDirection = v < 0 ? "reverse" : "normal";
    }
  });
}

export function togglePlay(app: App) {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = 0;
  } else {
    if (app.year >= LAST_YEAR) app.actions.setYear(FIRST_YEAR);
    playTimer = window.setInterval(() => {
      const next = Math.min(LAST_YEAR, app.year + 0.25);
      if (next >= LAST_YEAR) {
        clearInterval(playTimer);
        playTimer = 0;
      }
      app.actions.setYear(next);
    }, 70);
  }
  app.actions.setYear(app.year);
}

// The view to show: the one the user picked, else the one where the focus is drawn as itself
// rather than as a shadow copy, preferring the main stock-and-flow view.
export function chooseView(app: App): View {
  const views = drawableViews(app);
  const picked = views.find((v) => v.name === app.diagramView);
  if (picked) return picked;
  const score = (v: View) =>
    (v.objects.some((o) => o.key === app.focus) ? 4 : 0) + (v.objects.some((o) => o.key === app.focus && !o.shadow) ? 2 : 0) + (v.name === PREFERRED_VIEW ? 1 : 0);
  return [...views].sort((a, b) => score(b) - score(a))[0];
}

export function viewContains(app: App, name: string | null, key: string): boolean {
  return drawableViews(app).some((v) => v.name === name && v.objects.some((o) => o.key === key));
}

function drawableViews(app: App): View[] {
  return app.bundle.mdl.views.filter((v) => v.objects.length > 0);
}

function renderObject(app: App, o: SketchObject): string {
  const info = o.key ? app.sem.vars.get(o.key) : undefined;
  const focus = o.key && o.key === app.focus ? " focus" : "";
  const keyAttr = info ? ` data-key="${escapeHtml(o.key)}"` : "";
  const title = info ? `<title>${escapeHtml(info.name)}</title>` : "";
  if (o.kind === "cloud") return `<g class="cloud"><circle cx="${o.x - 6}" cy="${o.y + 2}" r="6"/><circle cx="${o.x + 5}" cy="${o.y + 2}" r="7"/><circle cx="${o.x}" cy="${o.y - 4}" r="7"/></g>`;
  if (o.kind === "valve") return `<g class="obj valve${focus}"${keyAttr}>${title}<circle cx="${o.x}" cy="${o.y}" r="7"/><path d="M${o.x - 5},${o.y - 5} L${o.x + 5},${o.y + 5} M${o.x + 5},${o.y - 5} L${o.x - 5},${o.y + 5}"/></g>`;
  if (o.kind === "stock") {
    const max = info ? peak(totalSeries(app, o.key)) : 1;
    const [x, y, w, h] = [o.x - o.w, o.y - o.h, o.w * 2, o.h * 2];
    return `<g class="obj stock${focus}"${keyAttr}>${title}
      <rect class="stock-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>
      ${info ? `<rect class="stock-level" data-level="${escapeHtml(o.key)}" data-max="${max || 1}" data-top="${y + 1}" data-height="${h - 2}" x="${x + 1}" width="${w - 2}" y="${y + h}" height="0"/>` : ""}
      ${label(x, y, w, h, `<span class="nm">${escapeHtml(info?.name ?? o.name)}</span>${info ? `<b data-value="${escapeHtml(o.key)}"></b>` : ""}`, "stock-label")}
    </g>`;
  }
  const color = info ? LAYERS[info.layer].color : "#888";
  const name = info?.name ?? o.name;
  const text = o.shadow ? `&lt;${escapeHtml(name)}&gt;` : escapeHtml(name);
  const value = o.kind === "flow" && info ? `<b data-value="${escapeHtml(o.key)}"></b>` : "";
  return `<g class="obj ${o.kind}${o.shadow ? " shadow" : ""}${focus}"${keyAttr}>${title}${label(o.x - o.w, o.y - o.h, o.w * 2, o.h * 2, `<span class="nm" style="--c:${color}">${text}</span>${value}`, `${o.kind}-label`)}</g>`;
}

function label(x: number, y: number, w: number, h: number, html: string, className: string): string {
  return `<foreignObject x="${x}" y="${y}" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" class="lbl ${className}">${html}</div></foreignObject>`;
}

function renderLink(app: App, link: SketchLink, byId: Map<number, SketchObject>): string {
  const from = byId.get(link.from);
  const to = byId.get(link.to);
  if (!from || !to) return "";
  if (link.kind === "pipe") {
    const valve = from.kind === "valve" ? from : to.kind === "valve" ? to : null;
    const target = valve === from ? to : from;
    const corners = link.points.filter(([x, y]) => x !== 0 || y !== 0);
    const start: [number, number] = [valve?.x ?? from.x, valve?.y ?? from.y];
    const last = corners.length ? corners[corners.length - 1] : start;
    const end = edgePoint(target, last);
    const d = `M${[start, ...corners.slice(0, -1), end].map((p) => p.join(",")).join(" L")}`;
    const flowAttr = valve?.key && app.sem.vars.has(valve.key) ? ` data-flow="${escapeHtml(valve.key)}"` : "";
    const head = link.arrowhead && valve === from ? ' marker-end="url(#pipehead)"' : "";
    const reverse = valve !== from ? ' style="animation-direction:reverse"' : "";
    return `<path class="pipe"${flowAttr}${head} d="${d}"/><path class="pipe-flow"${flowAttr}${reverse} d="${d}"/>`;
  }
  const a: [number, number] = [from.x, from.y];
  const b: [number, number] = [to.x, to.y];
  const bend = link.points.find(([x, y]) => x !== 0 || y !== 0);
  const control: [number, number] = bend ? [2 * bend[0] - (a[0] + b[0]) / 2, 2 * bend[1] - (a[1] + b[1]) / 2] : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = edgePoint(from, control);
  const end = edgePoint(to, control);
  const hot = from.key === app.focus || to.key === app.focus ? " hot" : "";
  return `<path class="arrow${hot}" data-from="${escapeHtml(from.key)}" data-to="${escapeHtml(to.key)}" marker-end="url(#arrowhead)" d="M${start.join(",")} Q${control.join(",")} ${end.join(",")}"/>`;
}

// Where a line from `toward` to the object's centre crosses the object's outline.
function edgePoint(o: SketchObject, toward: [number, number]): [number, number] {
  const dx = toward[0] - o.x;
  const dy = toward[1] - o.y;
  const w = Math.max(o.w, 6) + 2;
  const h = Math.max(o.h, 6) + 2;
  const s = Math.max(Math.abs(dx) / w, Math.abs(dy) / h);
  if (s <= 1) return [o.x, o.y];
  return [o.x + dx / s, o.y + dy / s];
}

function fitCamera(view: View, root: HTMLElement): Camera {
  const xs = view.objects.flatMap((o) => [o.x - o.w, o.x + o.w]);
  const ys = view.objects.flatMap((o) => [o.y - o.h, o.y + o.h]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(root.clientWidth / (x1 - x0 + 80), root.clientHeight / (y1 - y0 + 80));
  return { view: view.name, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale };
}

function applyCamera(root: HTMLElement) {
  const svg = root.querySelector("svg.diagram");
  if (!svg || !camera) return;
  const w = root.clientWidth / camera.scale;
  const h = root.clientHeight / camera.scale;
  svg.setAttribute("viewBox", `${camera.cx - w / 2} ${camera.cy - h / 2} ${w} ${h}`);
  root.classList.toggle("zoomed-out", camera.scale < 0.45);
}

function inViewport(root: HTMLElement, o: SketchObject): boolean {
  if (!camera) return false;
  const w = root.clientWidth / camera.scale / 2;
  const h = root.clientHeight / camera.scale / 2;
  return Math.abs(o.x - camera.cx) < w * 0.85 && Math.abs(o.y - camera.cy) < h * 0.85;
}

// Pan by dragging, zoom with the wheel around the pointer; listeners are attached once per root.
function wireDiagram(root: HTMLElement, app: App) {
  root.querySelectorAll<SVGGElement>(".obj[data-key]").forEach((el) =>
    el.addEventListener("click", () => {
      if (!dragMoved) app.actions.focus(el.dataset.key!);
    }),
  );
  if (root.dataset.diagramWired) return;
  root.dataset.diagramWired = "1";
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  root.addEventListener("pointerdown", (e) => {
    if (!camera || !root.querySelector("svg.diagram")) return;
    drag = { x: e.clientX, y: e.clientY, cx: camera.cx, cy: camera.cy };
    dragMoved = false;
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || !camera) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true;
    if (!dragMoved) return;
    camera = { ...camera, cx: drag.cx - dx / camera.scale, cy: drag.cy - dy / camera.scale };
    applyCamera(root);
  });
  window.addEventListener("pointerup", () => {
    drag = null;
    setTimeout(() => (dragMoved = false), 0);
  });
  root.addEventListener(
    "wheel",
    (e) => {
      if (!camera || !root.querySelector("svg.diagram")) return;
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const scale = Math.max(0.08, Math.min(4, camera.scale * Math.exp(-e.deltaY * 0.0015)));
      const mx = camera.cx + px / camera.scale;
      const my = camera.cy + py / camera.scale;
      camera = { ...camera, scale, cx: mx - px / scale, cy: my - py / scale };
      applyCamera(root);
    },
    { passive: false },
  );
}
