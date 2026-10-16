// Who moves where: each flow between groups of people, with the stock it drains and the stock it fills.
// A flow with no source brings people in from outside the model (starting to use); one with no
// destination takes them out (dying, or quitting for good).

import type { Semantics, VarInfo } from "./semantics.ts";

export type PeopleFlow = {
  key: string;
  name: string;
  from: string | null;
  to: string | null;
  exit: "death" | "quit" | null;
  countedIn: string[];
};

export function peopleFlows(sem: Semantics): PeopleFlow[] {
  const out: PeopleFlow[] = [];
  for (const info of sem.vars.values()) {
    const flow = describeFlow(sem, info);
    if (flow) out.push(flow);
  }
  return out;
}

export function describeFlow(sem: Semantics, info: VarInfo): PeopleFlow | null {
  const isPeople = (key: string) => sem.vars.get(key)?.role === "stock" && /people|person/i.test(sem.vars.get(key)!.units);
  const from = info.flows.find((f) => f.sign < 0 && isPeople(f.stock))?.stock ?? null;
  const to = info.flows.find((f) => f.sign > 0 && isPeople(f.stock))?.stock ?? null;
  if (!from && !to) return null;
  return {
    key: info.key,
    name: info.name,
    from,
    to,
    exit: to ? null : /death/.test(info.key) ? "death" : "quit",
    countedIn: info.flows.filter((f) => sem.vars.get(f.stock)?.role === "accounting").map((f) => f.stock),
  };
}

export function flowsOf(sem: Semantics, stock: string): { inflows: PeopleFlow[]; outflows: PeopleFlow[] } {
  const flows = peopleFlows(sem);
  return { inflows: flows.filter((f) => f.to === stock), outflows: flows.filter((f) => f.from === stock) };
}
