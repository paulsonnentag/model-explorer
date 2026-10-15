// A flow's rate written out as the product the model computes, with short names: the group the flow
// drains is "people", the fitted rate is "base rate", and each loop's factor is named by its family
// ("risk", "peers", …), which is unambiguous because a flow has at most one factor per family. The
// full model name is in each term's tooltip; hovering a term lights it up on the map.

import type { Factor } from "../shared/factors.ts";
import { escapeHtml } from "../shared/html.ts";
import { FAMILIES, type Loop, type LoopLink } from "../shared/loops.ts";
import { dejargon, plainFlowPhrase } from "../shared/plain.ts";
import { type MapApp, isActive, modelName } from "./context.ts";
import { shortName } from "./equations.ts";

// One line: `flow = people × base rate × risk^s × …`, with one loop's factor picked out.
export function formulaLine(app: MapApp, flow: string, picked: Loop | null): string {
  const factors = app.factors.get(flow);
  const lhs = `<a class="lhs" data-open="map>flow:${escapeHtml(flow)}" data-hover="flow:${escapeHtml(flow)}" data-var="${escapeHtml(flow)}" title="${escapeHtml(modelName(app, flow))}">${escapeHtml(flowName(app, flow))}</a>`;
  if (!factors) return `<span class="formula">${lhs} = <span class="muted">${escapeHtml(equationText(app, flow))}</span></span>`;
  const terms = factors.map((f, i) => {
    const op = i === 0 ? (f.power < 0 ? "1 ÷ " : "") : f.power < 0 ? " ÷ " : " × ";
    return `${op}${term(app, flow, f, picked)}`;
  });
  return `<span class="formula">${lhs} = ${terms.join("")}</span>`;
}

// The same factors as rows with their values this year, for a flow card.
export function factorRows(app: MapApp, flow: string): string {
  const factors = app.factors.get(flow);
  if (!factors) {
    return `<div class="equation"><span class="muted">Not a single product; per treatment type:</span><code>${escapeHtml(equationText(app, flow))}</code></div>`;
  }
  return `<ul class="factors">${factors
    .map((f, i) => {
      const op = i === 0 ? "" : f.power < 0 ? "÷" : "×";
      const loop = loopOf(app, f);
      const link = loop ? linkOf(loop, f.key) : null;
      if (loop && link) {
        const off = !isActive(app, link.strength);
        return `<li class="f f-loop${off ? " off" : ""}" style="--c:${FAMILIES[loop.family].color}" data-open="loop:${escapeHtml(loop.id)}" data-hover="loop:${escapeHtml(loop.id)}" data-var="${escapeHtml(loop.driver)}" title="${escapeHtml(tooltip(app, f, link, loop))}">
          <i>${op}</i><b data-live="x:${escapeHtml(f.key)}"></b><span>${FAMILIES[loop.family].noun}<sup>${exponent(app, link)}</sup></span></li>`;
      }
      return `<li class="f f-${f.kind}" data-hover="${hoverOf(app, flow, f)}" data-var="${escapeHtml(f.key)}" data-open="source:model.mdl>var:${escapeHtml(f.key)}" title="${escapeHtml(modelName(app, f.key))}"><i>${op}</i><b data-live="v:${escapeHtml(f.key)}"></b><span>${escapeHtml(factorName(app, flow, f))}</span></li>`;
    })
    .join("")}</ul>`;
}

export function exponent(app: MapApp, link: LoopLink): string {
  const s = link.sign * (app.fitted.get(link.strength) ?? 0);
  return isActive(app, link.strength) ? s.toFixed(2).replace("-", "−") : "0";
}

export function flowName(app: MapApp, flow: string): string {
  if (!app.plain) return modelName(app, flow);
  return plainFlowPhrase(flow) ?? dejargon(modelName(app, flow));
}

function term(app: MapApp, flow: string, f: Factor, picked: Loop | null): string {
  const loop = loopOf(app, f);
  const link = loop ? linkOf(loop, f.key) : null;
  if (loop && link) {
    const isPicked = picked?.id === loop.id;
    const off = !isActive(app, link.strength);
    return `<span class="t t-loop${isPicked ? " picked" : ""}${off ? " off" : ""}" style="--c:${FAMILIES[loop.family].color}" data-open="loop:${escapeHtml(loop.id)}" data-hover="loop:${escapeHtml(loop.id)}" data-var="${escapeHtml(loop.driver)}" title="${escapeHtml(tooltip(app, f, link, loop))}">${FAMILIES[loop.family].noun}<sup>${exponent(app, link)}</sup></span>`;
  }
  return `<span class="t t-${f.kind}" data-hover="${hoverOf(app, flow, f)}" data-var="${escapeHtml(f.key)}" data-open="source:model.mdl>var:${escapeHtml(f.key)}" title="${escapeHtml(modelName(app, f.key))}">${escapeHtml(factorName(app, flow, f))}</span>`;
}

function factorName(app: MapApp, flow: string, f: Factor): string {
  if (f.kind === "people") return "people";
  if (f.kind === "input") {
    const input = app.inputs.find((i) => i.key === f.key);
    if (input) return app.plain ? input.plainTitle : input.title;
  }
  if (/\b(rate|base|net)\b/i.test(f.key)) return "base rate";
  return shortName(app, f.key, flow);
}

function tooltip(app: MapApp, f: Factor, link: LoopLink, loop: Loop): string {
  return `${modelName(app, f.key)} = ${modelName(app, loop.driver)} ^ ${exponent(app, link)}`;
}

// People point at their box, inputs at the arrows they drive, and a rate at the flow it belongs to.
function hoverOf(app: MapApp, flow: string, f: Factor): string {
  if (f.kind === "people") return escapeHtml(`stock:${f.key}`);
  const input = f.kind === "input" ? app.inputs.find((i) => i.key === f.key) : undefined;
  return escapeHtml(input ? `input:${input.id}` : `flow:${flow}`);
}

function loopOf(app: MapApp, f: Factor): Loop | null {
  return f.loop ? (app.loops.find((l) => l.id === f.loop) ?? null) : null;
}

function linkOf(loop: Loop, coefficient: string): LoopLink | null {
  return loop.links.find((l) => l.coefficient === coefficient) ?? null;
}

function equationText(app: MapApp, flow: string): string {
  return (app.sem.vars.get(flow)?.definitions[0]?.expression ?? "").replace(/\s+/g, " ").trim();
}
