// The canvas: panels laid out on a board you can pan and zoom. A link unfolds its panel to the right of
// the one it is in, level with the link, and a wire joins the two, so the board keeps the path you
// took. Panels drag by their header and resize from their corner.

import type { Layout } from "../03-stock-map/app.ts";
import type { MapApp } from "../03-stock-map/context.ts";
import { VIEWS, createPanel, focusInPanel, menuHtml, panelEl, parseKey } from "../03-stock-map/panels.ts";

type Box = { x: number; y: number; w: number; h: number };
// The panel a panel was unfolded from, and how far down that panel the link was.
type Wire = { from: string; dy: number };
type Board = {
  el: HTMLElement;
  world: HTMLElement;
  wires: SVGSVGElement;
  boxes: Map<string, Box>;
  parents: Map<string, Wire>;
  camera: { x: number; y: number; z: number };
  // The last thing pressed, to unfold the next panel level with it.
  pressed: Element | null;
  top: number;
  // The camera move in progress, so a new one replaces it.
  flight: number;
};

const PANEL_H = 720;
const GAP = 90;
const MIN_W = 260;
const MIN_H = 200;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 1.6;
const FAR_ZOOM = 0.5;

export function canvasLayout(el: HTMLElement): Layout {
  const board: Board = {
    el,
    world: el.querySelector<HTMLElement>("#world")!,
    wires: el.querySelector<SVGSVGElement>("svg.wires")!,
    boxes: new Map(),
    parents: new Map(),
    camera: { x: 60, y: 60, z: 0.7 },
    pressed: null,
    top: 1,
    flight: 0,
  };
  enablePanning(board);
  enableToolbar(board);
  applyCamera(board);
  return {
    root: el,
    branches: true,
    place(app, key, from) {
      if (!app.panels.includes(key)) app.panels = [...app.panels, key];
      if (!board.boxes.has(key)) unfold(board, app, key, from);
    },
    render: (app) => renderBoard(board, app),
    reveal(app, key, spec) {
      const panel = panelEl(el, key);
      if (panel) panel.style.zIndex = String(++board.top);
      showBox(board, board.boxes.get(key));
      focusInPanel(el, app, key, spec);
    },
    start() {
      el.querySelector("#palette")!.classList.toggle("folded", board.boxes.size > 0);
      fitAll(board, false);
    },
  };
}

// Finds the new panel a spot: right of the panel the link was in and level with the link, moved down
// past any panel already there; panels opened from the menu go right of everything.
function unfold(board: Board, app: MapApp, key: string, from: string | undefined) {
  const size = sizeOf(app, key);
  const parent = from ? board.boxes.get(from) : undefined;
  let spot: Box;
  if (parent && from) {
    const dy = linkOffset(board, from, parent);
    board.parents.set(key, { from, dy });
    spot = { x: parent.x + parent.w + GAP, y: parent.y + Math.max(0, dy - 20), ...size };
  } else {
    const right = Math.max(-GAP, ...[...board.boxes.values()].map((b) => b.x + b.w));
    spot = { x: right + GAP, y: 0, ...size };
  }
  for (let blocker = overlapping(board, spot); blocker; blocker = overlapping(board, spot)) spot.y = blocker.y + blocker.h + GAP / 2;
  board.boxes.set(key, spot);
}

// The map keeps its proportions; every other panel is as wide as in the trail.
function sizeOf(app: MapApp, key: string): { w: number; h: number } {
  const { kind } = parseKey(key);
  const w = kind === "map" ? Math.round(((PANEL_H - 130) * app.layout.width) / app.layout.height) + 24 : VIEWS[kind].width(app);
  return { w, h: PANEL_H };
}

function linkOffset(board: Board, from: string, parent: Box): number {
  const panel = panelEl(board.el, from);
  if (!panel || !board.pressed || !panel.contains(board.pressed)) return 24;
  const offset = (board.pressed.getBoundingClientRect().top - panel.getBoundingClientRect().top) / board.camera.z;
  return Math.max(24, Math.min(parent.h - 24, offset));
}

function overlapping(board: Board, spot: Box): Box | undefined {
  const pad = GAP / 3;
  return [...board.boxes.values()].find((b) => spot.x < b.x + b.w + pad && b.x < spot.x + spot.w + pad && spot.y < b.y + b.h + pad && b.y < spot.y + spot.h + pad);
}

function renderBoard(board: Board, app: MapApp) {
  for (const panel of board.world.querySelectorAll<HTMLElement>(":scope > section.panel")) {
    if (app.panels.includes(panel.dataset.panel!)) continue;
    board.boxes.delete(panel.dataset.panel!);
    board.parents.delete(panel.dataset.panel!);
    panel.remove();
  }
  for (const key of app.panels) {
    if (panelEl(board.world, key)) continue;
    if (!board.boxes.has(key)) unfold(board, app, key, undefined);
    board.world.append(boardPanel(board, app, key));
  }
  drawWires(board);
  board.el.querySelector("#palette .entries")!.innerHTML = menuHtml(app);
}

function boardPanel(board: Board, app: MapApp, key: string): HTMLElement {
  const el = createPanel(app, key);
  el.classList.add("unfolding");
  el.style.zIndex = String(++board.top);
  const grip = el.appendChild(document.createElement("div"));
  grip.className = "grip";
  grip.title = "Drag to resize";
  placeEl(el, board.boxes.get(key)!);
  el.addEventListener("pointerdown", () => (el.style.zIndex = String(++board.top)));
  el.querySelector("header")!.addEventListener("pointerdown", (e) => {
    if (!(e.target as Element).closest("button")) drag(board, el, key, e, "move");
  });
  grip.addEventListener("pointerdown", (e) => drag(board, el, key, e, "resize"));
  el.addEventListener("animationend", () => el.classList.remove("unfolding"), { once: true });
  return el;
}

function placeEl(el: HTMLElement, box: Box) {
  Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
}

// Moves a panel by its header or resizes it by its corner, in board units whatever the zoom.
function drag(board: Board, el: HTMLElement, key: string, down: PointerEvent, mode: "move" | "resize") {
  down.preventDefault();
  down.stopPropagation();
  const box = board.boxes.get(key)!;
  const start = { ...box };
  const target = down.currentTarget as HTMLElement;
  target.setPointerCapture(down.pointerId);
  document.body.classList.add(mode === "move" ? "moving" : "resizing");
  target.onpointermove = (move) => {
    const dx = (move.clientX - down.clientX) / board.camera.z;
    const dy = (move.clientY - down.clientY) / board.camera.z;
    if (mode === "move") Object.assign(box, { x: start.x + dx, y: start.y + dy });
    else Object.assign(box, { w: Math.max(MIN_W, start.w + dx), h: Math.max(MIN_H, start.h + dy) });
    placeEl(el, box);
    drawWires(board);
  };
  target.onpointerup = target.onpointercancel = () => {
    target.onpointermove = target.onpointerup = target.onpointercancel = null;
    document.body.classList.remove("moving", "resizing");
  };
}

// A curve from the link's height on the parent's right edge to the child's header.
function drawWires(board: Board) {
  const paths = [...board.parents].flatMap(([key, wire]) => {
    const from = board.boxes.get(wire.from);
    const to = board.boxes.get(key);
    if (!from || !to) return [];
    const [x1, y1] = [from.x + from.w, from.y + Math.min(wire.dy, from.h - 12)];
    const [x2, y2] = [to.x, to.y + 22];
    const bend = Math.max(40, Math.abs(x2 - x1) / 2);
    return [`<path d="M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}"/><circle cx="${x1}" cy="${y1}" r="4"/><circle class="end" cx="${x2}" cy="${y2}" r="4"/>`];
  });
  board.wires.innerHTML = paths.join("");
}

// Dragging the background pans; the wheel pans too, or zooms with a pinch or ctrl. Over a panel the
// wheel scrolls the panel.
function enablePanning(board: Board) {
  const { el } = board;
  el.addEventListener("pointerdown", (e) => (board.pressed = e.target as Element), true);
  el.addEventListener("pointerdown", (e) => {
    const target = e.target as Element;
    if (target.closest("section.panel, #palette, #toolbar") || e.button !== 0) return;
    e.preventDefault();
    cancelAnimationFrame(board.flight);
    el.setPointerCapture(e.pointerId);
    document.body.classList.add("panning");
    const start = { ...board.camera, px: e.clientX, py: e.clientY };
    el.onpointermove = (move) => {
      board.camera.x = start.x + move.clientX - start.px;
      board.camera.y = start.y + move.clientY - start.py;
      applyCamera(board);
    };
    el.onpointerup = el.onpointercancel = () => {
      el.onpointermove = el.onpointerup = el.onpointercancel = null;
      document.body.classList.remove("panning");
    };
  });
  el.addEventListener(
    "wheel",
    (e) => {
      const zooming = e.ctrlKey || e.metaKey;
      if (!zooming && (e.target as Element).closest("section.panel, #palette")) return;
      e.preventDefault();
      cancelAnimationFrame(board.flight);
      if (zooming) return zoomAt(board, board.camera.z * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      board.camera.x -= e.deltaX;
      board.camera.y -= e.deltaY;
      applyCamera(board);
    },
    { passive: false },
  );
}

function enableToolbar(board: Board) {
  board.el.querySelector("#toolbar")!.addEventListener("click", (e) => {
    const action = (e.target as Element).closest<HTMLElement>("[data-zoom]")?.dataset.zoom;
    const rect = board.el.getBoundingClientRect();
    const [cx, cy] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    if (action === "in") zoomAt(board, board.camera.z * 1.25, cx, cy);
    if (action === "out") zoomAt(board, board.camera.z / 1.25, cx, cy);
    if (action === "fit") fitAll(board, true);
    if (action === "real") zoomAt(board, 1, cx, cy);
  });
  board.el.querySelector("#palette > button")!.addEventListener("click", () => board.el.querySelector("#palette")!.classList.toggle("folded"));
}

function zoomAt(board: Board, zoom: number, clientX: number, clientY: number) {
  cancelAnimationFrame(board.flight);
  const rect = board.el.getBoundingClientRect();
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const [px, py] = [clientX - rect.left, clientY - rect.top];
  const { camera } = board;
  camera.x = px - ((px - camera.x) * z) / camera.z;
  camera.y = py - ((py - camera.y) * z) / camera.z;
  camera.z = z;
  applyCamera(board);
}

function fitAll(board: Board, animate: boolean) {
  const boxes = [...board.boxes.values()];
  if (!boxes.length) return;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const w = Math.max(...boxes.map((b) => b.x + b.w)) - x;
  const h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
  moveCamera(board, frame(board, { x, y, w, h }, 1), animate);
}

// Brings a panel into view if it is not, zooming out only as far as needed to fit it.
function showBox(board: Board, box: Box | undefined) {
  if (!box) return;
  const { camera } = board;
  const rect = board.el.getBoundingClientRect();
  const [left, top] = [camera.x + box.x * camera.z, camera.y + box.y * camera.z];
  const inside = left >= 0 && top >= 0 && left + box.w * camera.z <= rect.width && top + box.h * camera.z <= rect.height;
  if (!inside) moveCamera(board, frame(board, box, camera.z), true);
}

// The camera that fits `box` in the window with a margin, no closer than `maxZoom`.
function frame(board: Board, box: Box, maxZoom: number): Board["camera"] {
  const rect = board.el.getBoundingClientRect();
  const margin = 48;
  const z = Math.max(MIN_ZOOM, Math.min(maxZoom, (rect.width - 2 * margin) / box.w, (rect.height - 2 * margin - 40) / box.h));
  return { x: (rect.width - box.w * z) / 2 - box.x * z, y: (rect.height - box.h * z) / 2 - box.y * z + 20, z };
}

function moveCamera(board: Board, to: Board["camera"], animate: boolean) {
  cancelAnimationFrame(board.flight);
  if (!animate) {
    board.camera = to;
    return applyCamera(board);
  }
  const from = { ...board.camera };
  const started = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / 380);
    const ease = 1 - (1 - t) ** 3;
    board.camera = { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease, z: from.z + (to.z - from.z) * ease };
    applyCamera(board);
    if (t < 1) board.flight = requestAnimationFrame(step);
  };
  board.flight = requestAnimationFrame(step);
}

// Zoomed far out, panel titles grow so the board still reads as a map of what is open.
function applyCamera(board: Board) {
  const { x, y, z } = board.camera;
  board.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  board.el.style.setProperty("--zi", String(1 / z));
  board.el.style.backgroundSize = `${24 * z}px ${24 * z}px`;
  board.el.style.backgroundPosition = `${x}px ${y}px`;
  board.el.classList.toggle("far", z < FAR_ZOOM);
  board.el.querySelector("#toolbar [data-zoom=real]")!.textContent = `${Math.round(z * 100)}%`;
}
