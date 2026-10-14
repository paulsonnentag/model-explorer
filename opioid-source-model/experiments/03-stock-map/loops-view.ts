// The left column: every effect the equations contain, grouped into feedback loops, effects driven
// from outside, and effects fitted to zero. A loop unfolds into the formulas it appears in, each with
// its multiplier over time; hovering or opening one paints its arrows on the map.

import { type Line, sparkline } from "../shared/chart.ts";
import { escapeHtml } from "../shared/html.ts";
import { type ExternalInput, FAMILIES, type Loop, type LoopLink, loopTitle } from "../shared/loops.ts";
import { type MapApp, bindHover, edgesOf, inputPath, isActive, loopActive, nameOf, referenceSeries, seriesOf, updateLive } from "./context.ts";
import { driverEquations } from "./equations.ts";
import { exponent, flowName, formulaLine } from "./formula.ts";

export function renderLoops(root: HTMLElement, app: MapApp) {
  const groups: [string, string, Loop[]][] = [
    ["Feedback loops", "The driver is computed from groups of people that these flows change.", app.loops.filter((l) => l.feedback && loopActive(app, l))],
    ["Driven from outside", "Same form, but the driver comes from data, so nothing circles back.", app.loops.filter((l) => !l.feedback && loopActive(app, l))],
    ["Fitted to zero", "Every strength was estimated at ~0: in the equations, but doing nothing.", app.loops.filter((l) => !loopActive(app, l))],
  ];
  root.innerHTML = `<div class="loops-head"><b>Effects on flows</b>
      <p>Each effect multiplies the rate of a few flows by <i>driver<sup>strength</sup></i>. The driver is 1 in 1999, so the multiplier starts at ×1.</p></div>
    ${groups
      .filter(([, , loops]) => loops.length)
      .map(([title, hint, loops]) => `<h3>${title}</h3><p class="hint">${hint}</p>${loops.map((l) => loopSection(app, l)).join("")}`)
      .join("")}`;
  if (!root.dataset.hoverBound) {
    bindHover(root, app);
    root.dataset.hoverBound = "1";
  }
  root.onclick = (e) => {
    const target = (e.target as Element).closest<HTMLElement>("[data-act]");
    if (!target) return;
    const [kind, ...rest] = target.dataset.act!.split(":");
    const id = rest.join(":");
    if (kind === "switch") return app.actions.switchLoop(id);
    if (kind === "flow-of") {
      const edge = edgesOf(app, [id])[0];
      if (edge) app.actions.toggle("flow", edge.id);
      return;
    }
    if (kind === "loop" || kind === "stock") app.actions.toggle(kind, id);
  };
  updateLoops(root, app);
}

export function updateLoops(root: HTMLElement, app: MapApp) {
  updateLive(root, app);
}

export function revealLoop(root: HTMLElement, id: string) {
  root.querySelector(`section.loop[data-loop="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function loopSection(app: MapApp, loop: Loop): string {
  const family = FAMILIES[loop.family];
  const open = app.openLoops.has(loop.id);
  const off = app.loopsOff.has(loop.id);
  const active = loopActive(app, loop);
  return `<section class="loop${open ? " open" : ""}${off ? " knocked" : ""}" data-loop="${escapeHtml(loop.id)}" data-hover="loop:${escapeHtml(loop.id)}" style="--c:${family.color}">
    <header data-act="loop:${escapeHtml(loop.id)}">
      <span class="chev">${open ? "▾" : "▸"}</span><i class="dot"></i>
      <span class="title">${escapeHtml(loopTitle(loop, app.plain))}<small>${escapeHtml(app.plain ? family.plainTitle : family.title)} · ${loop.flows.length} flow${loop.flows.length === 1 ? "" : "s"}</small></span>
      ${active ? `<button class="switch${off ? " off" : ""}" data-act="switch:${escapeHtml(loop.id)}" title="${off ? "Switch back on" : "Switch off: set its strengths to 1e-6 and re-run"}">${off ? "off" : "on"}</button>` : ""}
    </header>
    ${open ? loopBody(app, loop) : ""}
  </section>`;
}

function loopBody(app: MapApp, loop: Loop): string {
  const family = FAMILIES[loop.family];
  const active = loop.links.filter((l) => isActive(app, l.strength));
  const inactive = loop.links.filter((l) => !isActive(app, l.strength));
  const inputs = app.inputs.filter((i) => loop.inputs.includes(i.key));
  return `<div class="body">
    <div class="driver">
      ${spark(app, loop.driver, family.color)}
      <div><div class="label">Driver · <span title="${escapeHtml(loop.driver)}">${escapeHtml(nameOf(app, loop.driver))}</span></div>
        <b class="noun" style="color:${family.color}" data-hover="loop:${escapeHtml(loop.id)}" data-var="${escapeHtml(loop.driver)}">${family.noun}</b> <span class="val" data-live="v:${escapeHtml(loop.driver)}"></span>${/relative|index/.test(loop.driver) ? '<span class="muted"> · 1 = 1999 level</span>' : ""}</div>
    </div>
    ${driverEquations(app, loop)}
    ${inputs.length ? `<div class="fed">Outside inputs: ${inputs.map((i) => inputChip(app, loop, i)).join("")}</div>` : ""}
    ${active.map((link) => linkRow(app, loop, link, family.color)).join("")}
    ${inactive.length ? `<div class="inactive">Fitted to zero on: ${inactive.flatMap((l) => l.flows).map((f) => `<a data-act="flow-of:${escapeHtml(f)}" data-hover="flow:${escapeHtml(f)}" data-var="${escapeHtml(f)}">${escapeHtml(flowName(app, f))}</a>`).join(", ")}</div>` : ""}
  </div>`;
}

// Inside a loop an input lights up only the arrows through which it reaches this loop's driver.
function inputChip(app: MapApp, loop: Loop, input: ExternalInput): string {
  const path = inputPath(app, `${loop.id}|${input.id}`);
  const via = path.length ? ` → ${edgesOf(app, path).length} arrow${edgesOf(app, path).length === 1 ? "" : "s"}` : "";
  const hover = path.length ? `path:${loop.id}|${input.id}` : `input:${input.id}`;
  return `<span class="chip input" data-hover="${escapeHtml(hover)}" data-var="${escapeHtml(input.key)}">${escapeHtml(app.plain ? input.plainTitle : input.title)}${via}</span>`;
}

function linkRow(app: MapApp, loop: Loop, link: LoopLink, color: string): string {
  return `<div class="link">
    <div class="mult">${spark(app, link.coefficient, color)}<b data-live="x:${escapeHtml(link.coefficient)}"></b>
      <span class="muted">= <span class="noun" data-hover="loop:${escapeHtml(loop.id)}" data-var="${escapeHtml(loop.driver)}">${FAMILIES[loop.family].noun}</span><sup>${exponent(app, link)}</sup></span></div>
    ${link.flows.map((f) => `<div class="eq">${formulaLine(app, f, loop)}</div>`).join("")}
  </div>`;
}

function spark(app: MapApp, key: string, color: string): string {
  const lines: Line[] = [{ values: seriesOf(app, key), color, width: 1.4 }];
  const ref = referenceSeries(app, key);
  if (ref) lines.unshift({ values: ref, color: "#aaa", width: 1.1, dash: "3,2" });
  return sparkline(app.current.times, lines, 96, 28);
}
