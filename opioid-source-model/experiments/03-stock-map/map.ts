// Draws the map: one box per group of people, filled to its level, and one grey arrow per path between
// groups, as thick as the number of people taking it per year. Open or hovered loops paint the arrows
// they act on in their colour. Boxes collapse to a single line; arrows and boxes unfold into cards.

import { formatNumber, sparkline, stackedSparkline } from "../shared/chart.ts";
import { escapeHtml } from "../shared/html.ts";
import { FAMILIES } from "../shared/loops.ts";
import { peak } from "../shared/totals.ts";
import { CARD_W, flowCard, stockCard } from "./cards.ts";
import {
  HOVER_COLOR,
  type MapApp,
  PART_COLORS,
  PART_FILLS,
  type Toggle,
  bindHover,
  edgeReference,
  edgeValue,
  highlights,
  modelName,
  nameOf,
  partLabel,
  partSeries,
  rangeLabel,
  partValue,
  partsOf,
  referenceValue,
  seriesOf,
  stageLabel,
  substanceLabel,
  updateLive,
  valueAt,
} from "./context.ts";
import { COL_W, LEFT, type MapEdge, type MapNode, NODE_H, NODE_W, ROW_H, STAGES, SUBSTANCES, TOP } from "./layout.ts";

const MAX_WIDTH = 24;
const STUB = 54;
const COMPACT_H = 34;
const NEUTRAL = "#9aa3ad";
const SLOT_H = 900;
const LOWER_HALF = 0.55;
const MARKER_COLORS: Record<string, string> = { neutral: NEUTRAL, hover: HOVER_COLOR, ...Object.fromEntries(Object.entries(FAMILIES).map(([id, f]) => [id, f.color])) };

export function renderMap(root: HTMLElement, app: MapApp) {
  const { layout } = app;
  const nodeByKey = new Map(layout.nodes.map((n) => [n.key, n]));
  const columns = STAGES.map((_, i) => `<text class="col-title" x="${LEFT + i * COL_W}" y="22">${escapeHtml(stageLabel(app, i))}</text>`).join("");
  const rows = SUBSTANCES.map(
    (_, i) =>
      `<foreignObject x="6" y="${TOP + i * ROW_H - 30}" width="100" height="60"><div xmlns="http://www.w3.org/1999/xhtml" class="row-title">${escapeHtml(substanceLabel(app, i))}</div></foreignObject>`,
  ).join("");
  const edges = layout.edges.map((e) => renderEdge(app, e, nodeByKey)).join("");
  const nodes = layout.nodes.map((n, i) => renderNode(app, n, i)).join("");
  root.innerHTML = `<svg class="stock-map" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="xMidYMid meet">
    <defs>${Object.entries(MARKER_COLORS)
      .map(([id, color]) => `<marker id="head-${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`)
      .join("")}</defs>
    ${columns}${rows}<g class="edges">${edges}</g><g class="nodes">${nodes}</g><g class="cards"></g>
  </svg>`;
  const svg = root.querySelector("svg")!;
  svg.addEventListener("click", (e) => {
    const target = (e.target as Element).closest<HTMLElement | SVGElement>("[data-act]");
    if (!target || (e.target as Element).closest("a[href]")) return;
    const [kind, ...rest] = target.dataset.act!.split(":");
    const id = rest.join(":");
    if (kind === "open-loop") return app.actions.toggle("loop", id);
    app.actions.toggle(kind as Toggle, id);
  });
  enableDragging(svg, app);
  bindHover(svg, app);
  renderCards(root, app);
}

export function renderCards(root: HTMLElement, app: MapApp) {
  const nodeByKey = new Map(app.layout.nodes.map((n) => [n.key, n]));
  const cards: string[] = [];
  for (const edge of app.layout.edges) {
    if (!app.openFlows.has(edge.id)) continue;
    const anchor = root.querySelector<SVGTextElement>(`g.edge[data-edge="${CSS.escape(edge.id)}"] .value`)!;
    const [x, y] = [Number(anchor.getAttribute("x")), Number(anchor.getAttribute("y"))];
    const above = y > app.layout.height * LOWER_HALF;
    cards.push(placeCard(app, `flow:${edge.id}`, x + 10, above ? y - 14 : y + 8, above, flowCard(app, edge)));
  }
  for (const key of app.openStocks) {
    const node = nodeByKey.get(key)!;
    const above = node.y > app.layout.height * LOWER_HALF;
    const half = heightOf(app, node) / 2 + 6;
    cards.push(placeCard(app, `stock:${key}`, node.x - NODE_W / 2, above ? node.y - half : node.y + half, above, stockCard(app, key)));
  }
  root.querySelector("g.cards")!.innerHTML = cards.join("");
  updateMap(root, app);
}

export function updateMap(root: HTMLElement, app: MapApp) {
  const edgeById = new Map(app.layout.edges.map((e) => [e.id, e]));
  const lit = highlights(app);
  const width = (v: number) => 1.5 + MAX_WIDTH * Math.sqrt(Math.min(1, Math.abs(v) / app.maxFlow));
  root.querySelectorAll<SVGGElement>("g.edge").forEach((g) => {
    const edge = edgeById.get(g.dataset.edge!)!;
    const v = edgeValue(app, edge);
    const ref = edgeReference(app, edge);
    const share = Math.sqrt(Math.min(1, Math.abs(v) / app.maxFlow));
    const base = g.querySelector<SVGPathElement>(".base")!;
    const flow = g.querySelector<SVGPathElement>(".flow")!;
    const ghost = g.querySelector<SVGPathElement>(".ghost")!;
    const color = lit?.edges.get(edge.id) ?? null;
    const markerId = color ? (Object.entries(MARKER_COLORS).find(([, c]) => c === color)?.[0] ?? "neutral") : "neutral";
    base.style.strokeWidth = String(width(v) + (color ? 2 : 0));
    base.style.stroke = color ?? NEUTRAL;
    if (base.hasAttribute("marker-end")) base.setAttribute("marker-end", `url(#head-${markerId})`);
    const changed = ref !== null && Math.abs(ref - v) > Math.max(1, Math.abs(ref) * 0.01);
    ghost.style.strokeWidth = String(width(ref ?? 0));
    ghost.style.display = changed ? "" : "none";
    flow.style.opacity = Math.abs(v) < app.maxFlow * 1e-4 ? "0" : "";
    flow.style.animationDuration = `${(0.6 + 3.4 * (1 - share)).toFixed(2)}s`;
    flow.style.animationDirection = v < 0 ? "reverse" : "normal";
    const open = app.openFlows.has(edge.id);
    g.querySelector(".value")!.textContent = changed ? `${formatNumber(v)}/yr (was ${formatNumber(ref!)})` : `${formatNumber(v)}/yr`;
    g.style.setProperty("--c", color ?? "#59626c");
    g.classList.toggle("show-value", share > 0.3 || changed || open || color !== null);
    g.classList.toggle("lit", color !== null);
    g.classList.toggle("hot", color === HOVER_COLOR);
    g.classList.toggle("open", open);
  });
  root.querySelectorAll<SVGGElement>("g.node").forEach((g) => {
    const key = g.dataset.key!;
    const node = app.layout.nodes.find((n) => n.key === key)!;
    const h = heightOf(app, node);
    const v = valueAt(app, key);
    const levels = g.querySelector<SVGGElement>(".levels")!;
    const fraction = (x: number) => Math.max(0, Math.min(1, x / Number(levels.dataset.max)));
    const parts = partsOf(app, [key]);
    const values = parts ? parts.map((p) => partValue(app, p, app.current)) : [v];
    let below = 0;
    levels.querySelectorAll<SVGRectElement>(".level").forEach((rect, i) => {
      const [lo, hi] = [fraction(below), fraction(below + values[i])];
      rect.setAttribute("y", String(h * (1 - hi)));
      rect.setAttribute("height", String(h * (hi - lo)));
      below += values[i];
    });
    const ref = referenceValue(app, key);
    const ghost = g.querySelector<SVGLineElement>(".ghost-level")!;
    const changed = ref !== null && Math.abs(ref - v) > Math.max(1, Math.abs(ref) * 0.01);
    ghost.style.display = changed ? "" : "none";
    if (changed) for (const attr of ["y1", "y2"]) ghost.setAttribute(attr, String(h * (1 - fraction(ref))));
    const compact = app.compactStocks.has(key);
    g.querySelector(".value")!.textContent = changed && !compact ? `${formatNumber(v)} (was ${formatNumber(ref)})` : formatNumber(v);    const color = lit?.nodes.get(key);
    g.style.setProperty("--src", color ?? "transparent");
    g.classList.toggle("lit", !!color);
    g.classList.toggle("hot", color === HOVER_COLOR);
    g.classList.toggle("open", app.openStocks.has(key));
  });
  updateLive(root.querySelector("g.cards")!, app);
}

// A box whose stock is an array (one per medication) stacks its elements, in the fill and the chart.
function renderNode(app: MapApp, node: MapNode, index: number): string {
  const series = seriesOf(app, node.key);
  const compact = app.compactStocks.has(node.key);
  const h = heightOf(app, node);
  const parts = partsOf(app, [node.key]);
  const breakdown = parts ? `\nSplit by ${rangeLabel(app, node.key)}, bottom to top: ${parts.map((p) => partLabel(app, p.label)).join(", ")}` : "";
  const tip = (app.plain ? `${nameOf(app, node.key)}\nIn the model: ${modelName(app, node.key)}` : modelName(app, node.key)) + breakdown;
  const chart = parts
    ? stackedSparkline(app.current.times, parts.map((p, i) => ({ values: partSeries(app, p), color: PART_COLORS[i % PART_COLORS.length] })), 64, 20)
    : sparkline(app.current.times, [{ values: series, color: "#2f6db5", width: 1.2 }], 64, 20);
  const levels = (parts ?? [null]).map((_, i) => `<rect class="level" x="0" width="${NODE_W}" y="${h}" height="0"${parts ? ` style="fill:${PART_FILLS[i % PART_FILLS.length]}"` : ""}/>`).join("");
  const label = compact
    ? `<div xmlns="http://www.w3.org/1999/xhtml" class="node-label compact"><span class="name">${escapeHtml(nameOf(app, node.key))}</span><b class="value"></b></div>`
    : `<div xmlns="http://www.w3.org/1999/xhtml" class="node-label">
        <span class="name">${escapeHtml(nameOf(app, node.key))}</span>
        <span class="line"><b class="value"></b>${chart}</span>
      </div>`;
  return `<g class="node" data-key="${escapeHtml(node.key)}" data-hover="stock:${escapeHtml(node.key)}" data-var="${escapeHtml(node.key)}" transform="translate(${node.x - NODE_W / 2},${node.y - h / 2})">
    <title>${escapeHtml(tip)}</title>
    <rect class="box" width="${NODE_W}" height="${h}" rx="7" data-act="stock:${escapeHtml(node.key)}"/>
    <clipPath id="box-${index}"><rect width="${NODE_W}" height="${h}" rx="7"/></clipPath>
    <g class="levels" data-max="${peak(series) || 1}" clip-path="url(#box-${index})">${levels}</g>
    <line class="ghost-level" x1="0" x2="${NODE_W}" y1="0" y2="0"/>
    <foreignObject width="${NODE_W}" height="${h}" data-act="stock:${escapeHtml(node.key)}">${label}</foreignObject>
    <g class="chevron" data-act="compact:${escapeHtml(node.key)}" transform="translate(${NODE_W - 16},${compact ? h / 2 : 11})"><title>${compact ? "Show the chart" : "Collapse to one line"}</title><circle r="8"/><text dy="3.5">${compact ? "+" : "–"}</text></g>
  </g>`;
}

function renderEdge(app: MapApp, edge: MapEdge, nodeByKey: Map<string, MapNode>): string {
  const { d, label } = edgeGeometry(app, edge, nodeByKey);
  const end = edge.to ? `marker-end="url(#head-neutral)"` : "";
  const names = edge.flows.map((f) => nameOf(app, f.key)).join(" + ");
  return `<g class="edge" data-edge="${escapeHtml(edge.id)}" data-hover="edge:${escapeHtml(edge.id)}" data-var="${escapeHtml(edge.flows.map((f) => f.key).join("|"))}" data-act="flow:${escapeHtml(edge.id)}">
    <title>${escapeHtml(names)}\nClick to unfold</title>
    <path class="hit" d="${d}"/><path class="ghost" d="${d}"/><path class="base" d="${d}" ${end}/><path class="flow" d="${d}"/>
    ${edgeTerminal(app, edge, nodeByKey)}
    <text class="value" x="${label[0]}" y="${label[1]}"></text>
  </g>`;
}

// Cards in the lower part of the map open upwards so they stay inside it: the slot then ends at `y`.
function placeCard(app: MapApp, id: string, x: number, y: number, above: boolean, html: string): string {
  const [dx, dy] = app.cardOffsets.get(id) ?? [0, 0];
  const left = Math.min(app.layout.width - CARD_W - 4, x + dx);
  const top = (above ? y - SLOT_H : y) + dy;
  return `<foreignObject class="card-slot" data-slot="${escapeHtml(id)}" x="${left}" y="${top}" width="${CARD_W}" height="${SLOT_H}"><div xmlns="http://www.w3.org/1999/xhtml" class="slot${above ? " above" : ""}">${html}</div></foreignObject>`;
}

// Cards are dragged by their header; the offset is kept so a card stays put when values update.
function enableDragging(svg: SVGSVGElement, app: MapApp) {
  svg.addEventListener("pointerdown", (e) => {
    const handle = (e.target as Element).closest<HTMLElement>("[data-drag]");
    if (!handle || (e.target as Element).closest("button")) return;
    const id = handle.dataset.drag!;
    const slot = svg.querySelector<SVGForeignObjectElement>(`[data-slot="${CSS.escape(id)}"]`)!;
    svg.querySelector("g.cards")!.appendChild(slot);
    const scale = svg.getScreenCTM()!.a;
    const start = [e.clientX, e.clientY, Number(slot.getAttribute("x")), Number(slot.getAttribute("y"))];
    const [ox, oy] = app.cardOffsets.get(id) ?? [0, 0];
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - start[0]) / scale;
      const dy = (m.clientY - start[1]) / scale;
      slot.setAttribute("x", String(start[2] + dx));
      slot.setAttribute("y", String(start[3] + dy));
      app.cardOffsets.set(id, [ox + dx, oy + dy]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  });
}

function heightOf(app: MapApp, node: MapNode): number {
  return app.compactStocks.has(node.key) ? COMPACT_H : NODE_H;
}

// Stock-to-stock edges curve: pairs going both ways split to either side, and edges that skip a
// column arc around the box in between. Entries come down from above; exits go down below.
function edgeGeometry(app: MapApp, edge: MapEdge, nodeByKey: Map<string, MapNode>): { d: string; label: [number, number] } {
  const from = edge.from ? nodeByKey.get(edge.from)! : null;
  const to = edge.to ? nodeByKey.get(edge.to)! : null;
  if (!from && to) {
    const x = to.x - 46;
    const y = to.y - heightOf(app, to) / 2;
    return { d: `M${x},${y - STUB} L${x},${y - 4}`, label: [x + 6, y - STUB / 2] };
  }
  if (from && !to) {
    const x = from.x + (edge.kind === "death" ? 46 : -46);
    const y = from.y + heightOf(app, from) / 2;
    return { d: `M${x},${y} L${x},${y + STUB}`, label: [x + 6, y + STUB / 2 + 4] };
  }
  const a = from!;
  const b = to!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const normal: [number, number] = [-dy / length, dx / length];
  const twoWay = app.layout.edges.some((e) => e.from === edge.to && e.to === edge.from);
  const skipsColumn = a.substance === b.substance && Math.abs(a.stage - b.stage) > 1;
  const bend = skipsColumn ? 130 : twoWay ? 30 : 0;
  const control: [number, number] = [(a.x + b.x) / 2 + normal[0] * bend, (a.y + b.y) / 2 + normal[1] * bend];
  const start = boxEdge(a, heightOf(app, a), control);
  const end = boxEdge(b, heightOf(app, b), control, 6);
  const label: [number, number] = [0.25 * start[0] + 0.5 * control[0] + 0.25 * end[0], 0.25 * start[1] + 0.5 * control[1] + 0.25 * end[1]];
  return { d: `M${start.join(",")} Q${control.join(",")} ${end.join(",")}`, label };
}

function edgeTerminal(app: MapApp, edge: MapEdge, nodeByKey: Map<string, MapNode>): string {
  if (edge.from && edge.to) return "";
  if (!edge.from) {
    const to = nodeByKey.get(edge.to!)!;
    return `<text class="terminal" x="${to.x - 46}" y="${to.y - heightOf(app, to) / 2 - STUB - 6}">☁ starts</text>`;
  }
  const from = nodeByKey.get(edge.from)!;
  const x = from.x + (edge.kind === "death" ? 46 : -46);
  return `<text class="terminal" x="${x}" y="${from.y + heightOf(app, from) / 2 + STUB + 14}">${edge.kind === "death" ? "✝ dies" : "☁ stops"}</text>`;
}

function boxEdge(node: MapNode, height: number, toward: [number, number], gap = 2): [number, number] {
  const dx = toward[0] - node.x;
  const dy = toward[1] - node.y;
  const s = Math.max(Math.abs(dx) / (NODE_W / 2 + gap), Math.abs(dy) / (height / 2 + gap));
  return s <= 1 ? [node.x, node.y] : [node.x + dx / s, node.y + dy / s];
}
