// A driver written out as the equations that compute it, read straight from the model. Names are
// shortened against the line they appear under ("Perceived risk heroin use current" under "Perceived
// risk heroin use relative" is just "current"); hovering any name lights up what it is computed from.
// Only variables that lead back to people, flows or inputs get their own line, down to a fixed depth;
// pure parameters stay inline with their value.

import { type Expr, parseExpression } from "../core/expr.ts";
import { formatNumber } from "../shared/chart.ts";
import { escapeHtml } from "../shared/html.ts";
import { FAMILIES, type Loop } from "../shared/loops.ts";
import { dejargon, plainFlowPhrase } from "../shared/plain.ts";
import { type MapApp, valueAt } from "./context.ts";

const MAX_DEPTH = 3;
const DELAYS = new Set(["smoothi", "smooth", "smooth3", "smooth3i", "delay1", "delay1i", "delay3", "delay3i"]);

export function driverEquations(app: MapApp, loop: Loop): string {
  const color = FAMILIES[loop.family].color;
  const lines: { key: string; parent: string }[] = [];
  const seen = new Set([loop.driver]);
  const queue: [string, string, number][] = [[loop.driver, loop.driver, 0]];
  while (queue.length) {
    const [key, parent, depth] = queue.shift()!;
    lines.push({ key, parent });
    if (depth >= MAX_DEPTH) continue;
    for (const u of app.sem.vars.get(key)!.uses) {
      if (seen.has(u) || !expandable(app, u)) continue;
      seen.add(u);
      queue.push([u, key, depth + 1]);
    }
  }
  const shown = new Set(lines.map((l) => l.key));
  return `<div class="equations" style="--c:${color}">${lines
    .map(({ key, parent }, i) => {
      const lhs = i === 0 ? `<b class="noun" data-hover="loop:${escapeHtml(loop.id)}" data-var="${escapeHtml(key)}">${FAMILIES[loop.family].noun}</b>` : refHtml(app, key, parent, shown);
      return `<div class="eqn"><span><span class="lhs">${lhs}</span> <span class="op">=</span> ${exprHtml(app, key, shown)}</span><span class="val" data-live="v:${escapeHtml(key)}"></span></div>`;
    })
    .join("")}</div>`;
}

// The name of `key` with the leading words it shares with `context` removed.
export function shortName(app: MapApp, key: string, context: string): string {
  const name = app.sem.vars.get(key)?.modelName ?? key;
  const words = name.split(/\s+/);
  const against = (app.sem.vars.get(context)?.modelName ?? context).toLowerCase().split(/\s+/);
  let i = 0;
  while (i < words.length - 1 && i < against.length && words[i].toLowerCase() === against[i]) i++;
  const short = words.slice(i).join(" ");
  return app.plain ? dejargon(short).replace(/^./, (c) => c.toLowerCase()) : short;
}

function expandable(app: MapApp, key: string): boolean {
  const info = app.sem.vars.get(key);
  if (!info || key === "time" || isTerminal(app, key)) return false;
  return leadsToPeople(app, key, new Set());
}

const liveCache = new WeakMap<object, Map<string, boolean>>();

function leadsToPeople(app: MapApp, key: string, stack: Set<string>): boolean {
  const cache = liveCache.get(app.sem) ?? new Map<string, boolean>();
  liveCache.set(app.sem, cache);
  if (isTerminal(app, key)) return true;
  if (cache.has(key)) return cache.get(key)!;
  if (stack.has(key)) return false;
  stack.add(key);
  const result = app.sem.vars.get(key)!.uses.some((u) => leadsToPeople(app, u, stack));
  stack.delete(key);
  cache.set(key, result);
  return result;
}

function isTerminal(app: MapApp, key: string): boolean {
  const info = app.sem.vars.get(key)!;
  return info.role === "stock" || app.factors.has(key) || app.inputs.some((i) => i.key === key);
}

function exprHtml(app: MapApp, key: string, shown: Set<string>): string {
  const source = app.sem.vars.get(key)?.definitions[0]?.expression;
  if (!source) return "";
  try {
    return render(app, parseExpression(source), key, shown, 0);
  } catch {
    return `<code>${escapeHtml(source)}</code>`;
  }
}

const PRECEDENCE: Record<string, number> = { or: 1, and: 2, "=": 3, "<>": 3, "<": 3, ">": 3, "<=": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "^": 6 };
const SYMBOL: Record<string, string> = { "*": "×", "/": "÷", "-": "−", "<=": "≤", ">=": "≥", "<>": "≠" };

function render(app: MapApp, e: Expr, context: string, shown: Set<string>, outer: number): string {
  const r = (x: Expr, p = 0) => render(app, x, context, shown, p);
  if (e.type === "num") return formatNumber(e.value);
  if (e.type === "na") return "NA";
  if (e.type === "ref") return refHtml(app, e.key, context, shown);
  if (e.type === "unary") return e.op === "-" ? `−${r(e.arg, 7)}` : `not ${r(e.arg, 7)}`;
  if (e.type === "binary") {
    const p = PRECEDENCE[e.op] ?? 0;
    const right = e.op === "^" ? `<sup>${r(e.right)}</sup>` : ` ${SYMBOL[e.op] ?? e.op} ${r(e.right, p + 1)}`;
    const text = `${r(e.left, p)}${right}`;
    return p < outer ? `(${text})` : text;
  }
  const fn = e.fn.toLowerCase();
  const a = e.args;
  if (DELAYS.has(fn)) return `${r(a[0])} <em>${delayText(app, a[1], context, shown)}</em>`;
  if (fn === "active initial") return r(a[0], outer);
  if (fn === "initial") return `${r(a[0])} <em>in 1999</em>`;
  if (fn === "xidz" || fn === "zidz") return r({ type: "binary", op: "/", left: a[0], right: a[1] }, outer);
  if (fn === "if then else") return `<em>if</em> ${r(a[0])} <em>then</em> ${r(a[1])} <em>else</em> ${r(a[2])}`;
  if (fn === "sum") return `Σ ${r(a[0], 7)}`;
  if (fn === "ramp" || fn === "step") return `<em>policy ramp</em>`;
  if (fn === "get data mean") return `<em>mean of</em> ${r(a[0])} <em>(data)</em>`;
  return `${fn.toLowerCase()}(${a.map((x) => r(x)).join(", ")})`;
}

// SMOOTHI(x, IF THEN ELSE(current < indicated, up, down), init) reads as "delayed: up 2 yr, down 20 yr".
function delayText(app: MapApp, time: Expr, context: string, shown: Set<string>): string {
  const value = (x: Expr) => (x.type === "ref" ? `${formatNumber(valueAt(app, x.key))} yr` : x.type === "num" ? `${formatNumber(x.value)} yr` : render(app, x, context, shown, 0));
  if (time.type === "call" && time.fn.toLowerCase() === "if then else") return `delayed: rises over ${value(time.args[1])}, falls over ${value(time.args[2])}`;
  return `delayed over ${value(time)}`;
}

// A name in an equation. Lines below show their own equation; parameters show their value inline.
function refHtml(app: MapApp, key: string, context: string, shown: Set<string>): string {
  const info = app.sem.vars.get(key);
  if (!info) return escapeHtml(key);
  const flowPhrase = app.plain && app.factors.has(key) ? plainFlowPhrase(key) : null;
  const name = escapeHtml(flowPhrase ?? shortName(app, key, context));
  const constant = info.uses.length === 0 && !isTerminal(app, key);
  const value = constant ? `<small>${formatNumber(valueAt(app, key))}</small>` : "";
  const kind = info.role === "stock" ? " people" : app.factors.has(key) ? " flow" : app.inputs.some((i) => i.key === key) ? " input" : shown.has(key) ? " shown" : "";
  const input = app.inputs.find((i) => i.key === key);
  const hover = input ? `input:${input.id}` : `var:${key}`;
  return `<span class="v${kind}" data-hover="${escapeHtml(hover)}" data-var="${escapeHtml(key)}" data-open="source:model.mdl>var:${escapeHtml(key)}" title="${escapeHtml(info.modelName)}: ${escapeHtml(formatNumber(valueAt(app, key)))}">${name}${value}</span>`;
}
