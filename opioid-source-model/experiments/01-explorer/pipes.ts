// The pipe strip: for a group of people, where they come from and where they go; for a flow, which
// group it moves people out of and into. This is the physical side the dependency graph leaves out.

import { formatNumber, sparkline } from "../shared/chart.ts";
import { describeFlow, flowsOf, type PeopleFlow } from "../shared/flows.ts";
import { plainFlowPhrase } from "../shared/plain.ts";
import { type App, escapeHtml, totalAt, totalSeries } from "./context.ts";

const FLOW_COLOR = "#3f7fbf";
const STOCK_COLOR = "#2f6db5";

export function renderPipes(root: HTMLElement, app: App) {
  const info = app.sem.vars.get(app.focus);
  const flow = info ? describeFlow(app.sem, info) : null;
  const html = info?.role === "stock" && /people|person/i.test(info.units) ? stockStrip(app, app.focus) : flow ? flowStrip(app, flow) : "";
  root.innerHTML = html;
  root.classList.toggle("hidden", !html);
  root.querySelectorAll<HTMLElement>("[data-key]").forEach((el) => el.addEventListener("click", () => app.actions.focus(el.dataset.key!)));
}

function stockStrip(app: App, stock: string): string {
  const { inflows, outflows } = flowsOf(app.sem, stock);
  const byValue = (a: PeopleFlow, b: PeopleFlow) => totalAt(app, b.key, app.year) - totalAt(app, a.key, app.year);
  const rows = (flows: PeopleFlow[], side: "in" | "out") =>
    flows
      .sort(byValue)
      .map((f) => (side === "in" ? `${end(app, f.from, f, "in")}<span class="arrow">→</span>${flowChip(app, f)}` : `${flowChip(app, f)}<span class="arrow">→</span>${end(app, f.to, f, "out")}`))
      .map((r) => `<div class="pipe-row">${r}</div>`)
      .join("");
  return `<div class="pipe-title">People moving in ${app.year}: where they come from and where they go</div>
    <div class="pipe-strip">
      <div class="pipe-col in">${rows(inflows, "in") || '<div class="muted">No inflows</div>'}</div>
      ${stockChip(app, stock, true)}
      <div class="pipe-col out">${rows(outflows, "out") || '<div class="muted">No outflows</div>'}</div>
    </div>`;
}

function flowStrip(app: App, flow: PeopleFlow): string {
  const counted = flow.countedIn.length
    ? `<div class="pipe-note">Also counted in ${flow.countedIn.map((k) => `<a data-key="${escapeHtml(k)}">${escapeHtml(app.sem.vars.get(k)!.name)}</a>`).join(", ")}.</div>`
    : "";
  return `<div class="pipe-title">This flow moves people, in ${app.year}:</div>
    <div class="pipe-strip single">
      <div class="pipe-row">${end(app, flow.from, flow, "in")}<span class="arrow">→</span>${flowChip(app, flow, true)}<span class="arrow">→</span>${end(app, flow.to, flow, "out")}</div>
    </div>${counted}`;
}

function end(app: App, stock: string | null, flow: PeopleFlow, side: "in" | "out"): string {
  if (stock) return stockChip(app, stock, false);
  const label = side === "in" ? "Outside the model" : flow.exit === "death" ? "Dies" : "Leaves the model";
  const title = side === "in" ? "People who were not yet counted in any group, e.g. starting to use" : flow.exit === "death" ? "Removed by death" : "Stops using and is no longer tracked";
  return `<span class="pipe-end cloud" title="${title}">${side === "out" && flow.exit === "death" ? "✝" : "☁"} ${label}</span>`;
}

function stockChip(app: App, stock: string, isFocus: boolean): string {
  const info = app.sem.vars.get(stock)!;
  const spark = sparkline(app.current.times, [{ values: totalSeries(app, stock), color: STOCK_COLOR, width: 1.2 }], isFocus ? 90 : 56, isFocus ? 30 : 18);
  return `<span class="pipe-stock${isFocus ? " focus" : ""}" data-key="${escapeHtml(stock)}" title="Group of people: ${escapeHtml(info.name)}">
    <span class="name">${escapeHtml(info.name)}</span>
    <span class="value">${formatNumber(totalAt(app, stock, app.year))}</span>${spark}
  </span>`;
}

function flowChip(app: App, flow: PeopleFlow, isFocus = false): string {
  const spark = sparkline(app.current.times, [{ values: totalSeries(app, flow.key), color: FLOW_COLOR, width: 1.1 }], 48, 16);
  const info = app.sem.vars.get(flow.key)!;
  const label = info.name !== info.modelName ? (plainFlowPhrase(flow.key) ?? flow.name) : flow.name;
  return `<span class="pipe-flow${isFocus ? " focus" : ""}" data-key="${escapeHtml(flow.key)}" title="Flow: ${escapeHtml(flow.name)}">
    <span class="name">${escapeHtml(label)}</span>
    <span class="value">${formatNumber(totalAt(app, flow.key, app.year))}/yr</span>${spark}
  </span>`;
}
