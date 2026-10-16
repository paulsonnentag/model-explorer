// Cards that unfold on the map itself: a flow's history and the factors its rate is made of, or a
// group's description and the flows in and out of it.

import { type Line, sparkline, stackedSparkline } from "../shared/chart.ts";
import { escapeHtml } from "../shared/html.ts";
import { plainDescription } from "../shared/plain.ts";
import {
  type MapApp,
  PART_COLORS,
  flowLabel,
  nameOf,
  partLabel,
  partSeries,
  partsOf,
  rangeLabel,
  referenceSeries,
  seriesOf,
  sourceLink,
  stageLabel,
  substanceLabel,
} from "./context.ts";
import { factorRows } from "./formula.ts";
import type { MapEdge } from "./layout.ts";

export const CARD_W = 290;

export function flowCard(app: MapApp, edge: MapEdge): string {
  const exit = edge.kind === "death" ? "dies" : "stops using";
  const title = edge.from && edge.to ? `${nameOf(app, edge.from)} → ${nameOf(app, edge.to)}` : edge.from ? `${nameOf(app, edge.from)} → ${exit}` : `starts → ${nameOf(app, edge.to)}`;
  return `<div class="card flow-card" data-card="flow:${escapeHtml(edge.id)}">
    <header data-drag="flow:${escapeHtml(edge.id)}"><span>${escapeHtml(title)}</span><button data-act="flow:${escapeHtml(edge.id)}" title="Collapse">×</button></header>
    ${edge.flows
      .map(
        (f) => `<section>
          <div class="flow-head"><span>${escapeHtml(flowLabel(app, f))}</span><b data-live="flow:${escapeHtml(f.key)}"></b></div>
          <div class="src-row">${sourceLink(app, f.key)}</div>
          ${spark(app, f.key)}
          ${partRows(app, f.key)}
          ${factorRows(app, f.key)}
        </section>`,
      )
      .join("")}
  </div>`;
}

export function stockCard(app: MapApp, key: string): string {
  const node = app.layout.nodes.find((n) => n.key === key)!;
  const description = (app.plain ? plainDescription(key) : null) ?? app.sem.vars.get(key)?.comment ?? "";
  const inflows = app.layout.edges.filter((e) => e.to === key);
  const outflows = app.layout.edges.filter((e) => e.from === key);
  const item = (e: MapEdge, other: string | null, fallback: string) =>
    `<li data-act="flow:${escapeHtml(e.id)}" data-hover="edge:${escapeHtml(e.id)}"><span>${escapeHtml(other ? nameOf(app, other) : fallback)}</span><b data-live="edge:${escapeHtml(e.id)}"></b></li>`;
  return `<div class="card stock-card" data-card="stock:${escapeHtml(key)}">
    <header data-drag="stock:${escapeHtml(key)}"><span>${escapeHtml(stageLabel(app, node.stage))} · ${escapeHtml(substanceLabel(app, node.substance))}</span><button data-act="stock:${escapeHtml(key)}" title="Collapse">×</button></header>
    <section>
      <div class="model-name">${app.plain ? escapeHtml(app.sem.vars.get(key)?.modelName ?? key) : ""} ${sourceLink(app, key)}</div>
      ${description ? `<p class="desc">${escapeHtml(description)}</p>` : ""}
      ${partsOf(app, [key]) ? `${spark(app, key)}${partRows(app, key)}` : ""}
      <h4>Coming in</h4><ul class="moves">${inflows.map((e) => item(e, e.from, "starts using")).join("") || '<li class="muted">Nothing</li>'}</ul>
      <h4>Going out</h4><ul class="moves">${outflows.map((e) => item(e, e.to, e.kind === "death" ? "dies" : "stops using")).join("") || '<li class="muted">Nothing</li>'}</ul>    </section>
  </div>`;
}

// One row per element of an arrayed variable, coloured like its band in the stacked chart.
function partRows(app: MapApp, key: string): string {
  const parts = partsOf(app, [key]);
  if (!parts) return "";
  return `<div class="parts-title">By ${escapeHtml(rangeLabel(app, key))}</div><ul class="parts">${parts
    .map((p, i) => {
      const spec = `${p.label}|${key}`;
      return `<li><i style="background:${PART_COLORS[i % PART_COLORS.length]}"></i><span>${escapeHtml(partLabel(app, p.label))}</span><b data-live="part:${escapeHtml(spec)}"></b><small data-live="share:${escapeHtml(spec)}"></small></li>`;
    })
    .reverse()
    .join("")}</ul>`;
}

function spark(app: MapApp, key: string): string {
  const parts = partsOf(app, [key]);
  if (parts) return stackedSparkline(app.current.times, parts.map((p, i) => ({ values: partSeries(app, p), color: PART_COLORS[i % PART_COLORS.length] })), CARD_W - 24, 34);
  const lines: Line[] = [{ values: seriesOf(app, key), color: "#1f2328", width: 1.3 }];
  const ref = referenceSeries(app, key);
  if (ref) lines.unshift({ values: ref, color: "#aaa", width: 1.1, dash: "3,2" });
  return sparkline(app.current.times, lines, CARD_W - 24, 34);
}
