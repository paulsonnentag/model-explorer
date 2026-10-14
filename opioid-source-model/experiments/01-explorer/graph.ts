// The provenance graph: what the focused variable is computed from (left), the variable itself
// (centre), and what it feeds into (right). Every node shows its live values.

import { formatNumber, sparkline } from "../shared/chart.ts";
import { type App, REFERENCE_COLOR, constantValue, dataPointsFor, escapeHtml, isConstant, visibleCells } from "./context.ts";
import { ANSWERS } from "../shared/runs.ts";
import { LAYERS, ROLES, type Layer, type Role, type VarInfo } from "../shared/semantics.ts";

const NODE_W = 230;
const FOCUS_W = 270;
const NODE_H = 64;
const FOCUS_H = 96;
const ROW_GAP = 12;
const COL_GAP = 84;
const TOP = 26;
const COLUMN_LIMIT = 12;
const LAYER_ORDER: Layer[] = ["what-ifs", "evidence", "quantities", "theory", "measurement", "settings"];

type Column = { id: string; title: string; keys: string[]; hidden: number };

export function renderGraph(root: HTMLElement, app: App) {
  const focus = app.sem.vars.get(app.focus);
  if (!focus) return;
  const columns = buildColumns(app, focus);
  const layout = layoutColumns(columns);
  const nodes = layout.positions
    .map(({ key, x, y, w, h }) => renderNode(app, app.sem.vars.get(key)!, x, y, w, h, key === app.focus))
    .join("");
  const titles = layout.columns.map((c) => `<div class="col-title" style="left:${c.x}px">${c.title}</div>`).join("");
  const more = layout.columns
    .filter((c) => c.hidden > 0)
    .map((c) => `<a class="more" style="left:${c.x}px;top:${c.bottom + 4}px" data-expand="${c.id}">+ ${c.hidden} more</a>`)
    .join("");
  root.innerHTML = `<div class="canvas" style="width:${layout.width}px;height:${layout.height}px">
    <svg class="edges" width="${layout.width}" height="${layout.height}">${renderEdges(app, layout)}</svg>
    ${titles}${nodes}${more}
  </div>`;
  wireGraph(root, app);
  const focusNode = layout.positions.find((p) => p.key === app.focus)!;
  root.scrollLeft = focusNode.x + FOCUS_W / 2 - root.clientWidth / 2 + 20;
  root.scrollTop = focusNode.y + FOCUS_H / 2 - root.clientHeight / 2;
}

export function renderRoots(root: HTMLElement, app: App) {
  const upstream = closure(app, app.focus, (v) => v.uses);
  const downstream = closure(app, app.focus, (v) => v.usedBy);
  const byRole = new Map<Role, string[]>();
  for (const key of upstream) {
    const info = app.sem.vars.get(key)!;
    if (info.layer === "theory" || info.layer === "measurement") continue;
    byRole.set(info.role, [...(byRole.get(info.role) ?? []), key]);
  }
  const roleOrder = Object.keys(ROLES) as Role[];
  const chips = [...byRole]
    .sort((a, b) => roleOrder.indexOf(a[0]) - roleOrder.indexOf(b[0]))
    .map(
      ([role, keys]) =>
        `<span class="root-chip${app.openRoots === role ? " open" : ""}" data-roots="${role}"><span class="dot" style="background:${LAYERS[ROLES[role].layer].color}"></span>${keys.length} ${ROLES[role].label.toLowerCase()}</span>`,
    )
    .join("");
  const theoryCount = [...upstream].filter((k) => app.sem.vars.get(k)!.layer === "theory").length;
  const openKeys = app.openRoots ? byRole.get(app.openRoots as Role) ?? [] : [];
  const list = openKeys.length
    ? `<div class="root-list">${openKeys
        .sort((a, b) => app.sem.vars.get(a)!.name.localeCompare(app.sem.vars.get(b)!.name))
        .map((k) => `<a data-key="${escapeHtml(k)}">${escapeHtml(app.sem.vars.get(k)!.name)}</a>`)
        .join("")}</div>`
    : "";
  const influenced = ANSWERS.filter((a) => {
    const outcome = a.id === "fentanyl" ? "cumulative overdose deaths" : a.variable;
    return outcome === app.focus || downstream.has(outcome);
  });
  const influence = influenced.length
    ? `<div style="margin-top:4px"><span class="lead">Influences the answers:</span>${influenced.map((a) => `<span class="root-chip" data-key="${escapeHtml(a.variable)}">${a.label}</span>`).join("")}</div>`
    : "";
  root.innerHTML = upstream.size
    ? `<span class="lead">Everything this comes from:</span>${chips}<span class="muted"> via ${theoryCount} theory variables</span>${list}${influence}`
    : `<span class="lead">This is a root: nothing in the model computes it.</span>${influence}`;
  root.querySelectorAll<HTMLElement>("[data-roots]").forEach((el) => el.addEventListener("click", () => app.actions.toggleRoots(el.dataset.roots!)));
  root.querySelectorAll<HTMLElement>("[data-key]").forEach((el) => el.addEventListener("click", () => app.actions.focus(el.dataset.key!)));
}

function buildColumns(app: App, focus: VarInfo): Column[] {
  const vars = app.sem.vars;
  const seen = new Set([focus.key]);
  const take = (keys: Iterable<string>) => {
    const out = [...new Set(keys)].filter((k) => !seen.has(k) && vars.has(k));
    out.forEach((k) => seen.add(k));
    return sortKeys(app, out);
  };
  const up1 = take(focus.uses);
  const down1 = take(focus.usedBy);
  const up2 = take(up1.flatMap((k) => vars.get(k)!.uses));
  const down2 = take(down1.flatMap((k) => vars.get(k)!.usedBy));
  const column = (id: string, title: string, keys: string[]): Column => {
    const expanded = app.expandedColumns.has(`${focus.key}:${id}`);
    const shown = expanded ? keys : keys.slice(0, COLUMN_LIMIT);
    return { id, title, keys: shown, hidden: keys.length - shown.length };
  };
  return [
    column("up2", "Comes from (2 steps)", up2),
    column("up1", "Computed from", up1),
    { id: "focus", title: "", keys: [focus.key], hidden: 0 },
    column("down1", "Feeds into", down1),
    column("down2", "Then into", down2),
  ].filter((c) => c.keys.length);
}

function sortKeys(app: App, keys: string[]): string[] {
  return keys.sort((a, b) => {
    const va = app.sem.vars.get(a)!;
    const vb = app.sem.vars.get(b)!;
    return LAYER_ORDER.indexOf(va.layer) - LAYER_ORDER.indexOf(vb.layer) || va.name.localeCompare(vb.name);
  });
}

type Layout = {
  positions: { key: string; column: string; x: number; y: number; w: number; h: number }[];
  columns: { id: string; title: string; x: number; bottom: number; hidden: number }[];
  width: number;
  height: number;
};

function layoutColumns(columns: Column[]): Layout {
  const heightOf = (c: Column) => (c.id === "focus" ? FOCUS_H : c.keys.length * (NODE_H + ROW_GAP) - ROW_GAP);
  const tallest = Math.max(...columns.map(heightOf));
  const positions: Layout["positions"] = [];
  const placed: Layout["columns"] = [];
  let x = 0;
  for (const c of columns) {
    const w = c.id === "focus" ? FOCUS_W : NODE_W;
    const top = TOP + (tallest - heightOf(c)) / 2;
    c.keys.forEach((key, i) => {
      const h = c.id === "focus" ? FOCUS_H : NODE_H;
      positions.push({ key, column: c.id, x, y: top + i * (NODE_H + ROW_GAP), w, h });
    });
    placed.push({ id: c.id, title: c.title, x, bottom: top + heightOf(c), hidden: c.hidden });
    x += w + COL_GAP;
  }
  return { positions, columns: placed, width: x - COL_GAP, height: TOP + tallest + 40 };
}

function renderNode(app: App, info: VarInfo, x: number, y: number, w: number, h: number, isFocus: boolean): string {
  const color = LAYERS[info.layer].color;
  const edited = info.cells.some((c) => app.whatIf.edits.has(c));
  const units = info.units && info.units !== "dmnl" ? ` · ${escapeHtml(info.units)}` : "";
  return `<div class="node${isFocus ? " focus" : ""}${edited ? " edited" : ""}" data-key="${escapeHtml(info.key)}" style="left:${x}px;top:${y}px;border-left-color:${color}" title="${escapeHtml(info.name)}">
    <div class="role">${ROLES[info.role].label}${units}</div>
    <div class="name">${escapeHtml(info.name)}</div>
    ${nodeValue(app, info, isFocus ? 120 : 86, isFocus ? 54 : 32)}
  </div>`;
}

function nodeValue(app: App, info: VarInfo, width: number, height: number): string {
  if (isConstant(app, info.key)) {
    const cells = visibleCells(app, info.key, 99);
    const value = constantValue(app, cells[0]);
    const note = info.fitted ? `fitted ${formatNumber(info.fitted.lower)}–${formatNumber(info.fitted.upper)}` : cells.length > 1 ? `${cells.length} values` : "";
    return `<div class="const-value">${formatNumber(value)}${note ? `<small>${note}</small>` : ""}</div>`;
  }
  const color = LAYERS[info.layer].color;
  const cells = visibleCells(app, info.key, 3);
  const lines = cells.map((c) => ({ values: app.current.series(c), color, width: 1.3 }));
  if (app.reference) lines.unshift(...cells.slice(0, 1).map((c) => ({ values: app.reference!.series(c), color: REFERENCE_COLOR, dash: "3,2", width: 1.1 })));
  return sparkline(app.current.times, lines, width, height, dataPointsFor(app, info.key));
}

function renderEdges(app: App, layout: Layout): string {
  const byColumn = new Map<string, Layout["positions"]>();
  for (const p of layout.positions) byColumn.set(p.column, [...(byColumn.get(p.column) ?? []), p]);
  const order = layout.columns.map((c) => c.id);
  const paths: string[] = [];
  for (let i = 0; i + 1 < order.length; i++) {
    for (const left of byColumn.get(order[i]) ?? []) {
      for (const right of byColumn.get(order[i + 1]) ?? []) {
        const target = app.sem.vars.get(right.key)!;
        if (!target.uses.includes(left.key)) continue;
        const source = app.sem.vars.get(left.key)!;
        const x1 = left.x + left.w;
        const y1 = left.y + left.h / 2;
        const x2 = right.x;
        const y2 = right.y + right.h / 2;
        const mid = (x1 + x2) / 2;
        const color = LAYERS[source.layer].color;
        paths.push(
          `<path class="edge" data-from="${escapeHtml(left.key)}" data-to="${escapeHtml(right.key)}" stroke="${color}" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}"/>`,
        );
        const flow = source.flows.find((f) => f.stock === right.key);
        if (flow) {
          const lx = x1 + (x2 - x1) * 0.12;
          const ly = y1 + (y2 - y1) * 0.06 - 4;
          paths.push(`<text class="edge-sign" x="${lx}" y="${ly}" fill="${flow.sign > 0 ? "#2e8a57" : "#c7473a"}">${flow.sign > 0 ? "+ fills" : "− drains"}</text>`);
        }
      }
    }
  }
  return paths.join("");
}

function wireGraph(root: HTMLElement, app: App) {
  root.querySelectorAll<HTMLElement>(".node").forEach((el) => {
    const key = el.dataset.key!;
    el.addEventListener("click", () => app.actions.focus(key));
    el.addEventListener("mouseenter", () => highlight(root, key, true));
    el.addEventListener("mouseleave", () => highlight(root, key, false));
  });
  root.querySelectorAll<HTMLElement>("[data-expand]").forEach((el) => el.addEventListener("click", () => app.actions.expandColumn(el.dataset.expand!)));
}

function highlight(root: HTMLElement, key: string, on: boolean) {
  root.querySelectorAll<SVGPathElement>(".edge").forEach((edge) => {
    if (edge.dataset.from === key || edge.dataset.to === key) edge.classList.toggle("hot", on);
  });
}

function closure(app: App, start: string, next: (v: VarInfo) => string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...next(app.sem.vars.get(start)!)];
  while (stack.length) {
    const key = stack.pop()!;
    if (seen.has(key) || key === start) continue;
    seen.add(key);
    const info = app.sem.vars.get(key);
    if (info) stack.push(...next(info));
  }
  return seen;
}
