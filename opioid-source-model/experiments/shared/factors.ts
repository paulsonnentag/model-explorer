// Breaks a flow's equation into the factors its rate is a product of: the people it applies to, a
// base rate, the multipliers set by feedback loops, and external inputs. Intermediate variables that
// are themselves plain products are inlined; anything else (a policy ramp, a sum, a MIN) stays as one
// factor under the variable that holds it, so every factor has a value in the run.

import { type Expr, parseExpression } from "../core/expr.ts";
import type { ExternalInput, Loop } from "./loops.ts";
import type { Semantics } from "./semantics.ts";

export type FactorKind = "people" | "loop" | "input" | "rate";

export type Factor = { key: string; kind: FactorKind; power: 1 | -1; loop: string | null };

const MAX_DEPTH = 6;

// Null when the flow is not a product of variables, e.g. treatment entry limited by capacity.
export function rateFactors(sem: Semantics, flow: string, loops: Loop[], inputs: ExternalInput[]): Factor[] | null {
  const loopOf = new Map(loops.flatMap((loop) => loop.links.map((link) => [link.coefficient, loop.id] as const)));
  const inputKeys = new Set(inputs.map((i) => i.key));
  const parts = productOf(sem, flow);
  if (!parts) return null;
  const out: Factor[] = [];
  const expand = (key: string, power: 1 | -1, depth: number) => {
    const info = sem.vars.get(key)!;
    const leaf = (kind: FactorKind) => out.push({ key, kind, power, loop: kind === "loop" ? loopOf.get(key)! : null });
    if (info.role === "stock") return leaf("people");
    if (loopOf.has(key)) return leaf("loop");
    if (inputKeys.has(key)) return leaf("input");
    const inner = depth < MAX_DEPTH ? productOf(sem, key) : null;
    if (!inner || inner.length < 2) return leaf("rate");
    for (const part of inner) expand(part.key, (power * part.power) as 1 | -1, depth + 1);
  };
  for (const part of parts) expand(part.key, part.power, 1);
  return out;
}

// The variables an equation multiplies and divides, or null if it is anything else.
function productOf(sem: Semantics, key: string): { key: string; power: 1 | -1 }[] | null {
  const info = sem.vars.get(key);
  if (!info || info.definitions.length !== 1 || info.definitions[0].kind !== "equation") return null;
  const parts: { key: string; power: 1 | -1 }[] = [];
  const walk = (e: Expr, power: 1 | -1): boolean => {
    if (e.type === "binary" && e.op === "*") return walk(e.left, power) && walk(e.right, power);
    if (e.type === "binary" && e.op === "/") return walk(e.left, power) && walk(e.right, (-power) as 1 | -1);
    if (e.type === "ref" && e.subscripts.length === 0 && sem.vars.has(e.key)) {
      parts.push({ key: e.key, power });
      return true;
    }
    return false;
  };
  try {
    return walk(parseExpression(info.definitions[0].expression), 1) ? parts : null;
  } catch {
    return null;
  }
}
