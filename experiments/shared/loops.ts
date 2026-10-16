// Feedback loops and external inputs, read off the model's equations rather than the paper's diagram.
// Every effect in the model has the form `driver relative ^ strength`: a strength variable sets how
// hard a driver (perceived risk, social influence, availability) pushes on a few flows. A loop is one
// driver with its strengths; it closes when the driver is computed from groups of people. Setting its
// strengths to ~0 makes the effect ≈1, which switches the loop off.

import { describeFlow } from "./flows.ts";
import type { Semantics } from "./semantics.ts";

export type LoopFamily = "si" | "pr" | "av" | "adf";

// One strength, the coefficient it sets, and the flows that coefficient multiplies. The coefficient is
// `driver ^ (sign × strength)`.
export type LoopLink = { strength: string; coefficient: string; sign: 1 | -1; flows: string[] };

export type Loop = {
  id: string;
  family: LoopFamily;
  driver: string;
  links: LoopLink[];
  flows: string[];
  people: string[];
  inputs: string[];
  // People flows the driver is computed from, such as overdose deaths for perceived risk.
  driverFlows: string[];
  feedback: boolean;
};

// Strengths at or below this were fitted to "no effect"; the authors' own knockout value is 1e-6.
export const INACTIVE = 1e-4;

export type ExternalInput = { id: string; key: string; title: string; plainTitle: string; unit: string; flows: string[] };

// `noun` names the family's factor inside a formula; a flow has at most one factor per family.
export const FAMILIES: Record<LoopFamily, { title: string; plainTitle: string; noun: string; letter: string; color: string; description: string }> = {
  si: {
    letter: "S",
    noun: "peers",
    title: "Social influence",
    plainTitle: "Others are doing it",
    color: "#3b7dd8",
    description: "The more people are in a group, the more others follow them in. The model scales a few start and progression rates by how many people currently use, relative to 1999.",
  },
  pr: {
    letter: "R",
    noun: "risk",
    title: "Perceived risk",
    plainTitle: "Overdoses scare people off",
    color: "#e07b24",
    description: "Recent overdose deaths make opioids look riskier, which lowers starting and raises quitting.",
  },
  av: {
    letter: "A",
    noun: "availability",
    title: "Street availability",
    plainTitle: "How easy it is to get",
    color: "#8e6bbf",
    description: "How easy pills or heroin are to get on the street. For pills this depends on how many people are prescribed or misuse them; for heroin it follows the price index.",
  },
  adf: {
    letter: "D",
    noun: "ADF",
    title: "Abuse-deterrent pills",
    plainTitle: "Harder-to-abuse pills",
    color: "#0f8a7a",
    description: "The share of prescribed opioids in abuse-deterrent form pushes people addicted to pills toward heroin.",
  },
};

const LOOP_TITLES: Record<string, { title: string; plainTitle: string }> = {
  "perceived risk rx use relative": { title: "Perceived risk of Rx use", plainTitle: "Pill overdoses make pills look risky" },
  "perceived risk heroin use relative": { title: "Perceived risk of heroin use", plainTitle: "Heroin overdoses make heroin look risky" },
  "si on initiating rx misuse relative": { title: "SI on initiating Rx misuse", plainTitle: "Pill misusers draw others into misuse" },
  "si on developing rx oud relative": { title: "SI on developing Rx OUD", plainTitle: "Pill addiction spreads through peers" },
  "si on initiating heroin relative": { title: "SI on initiating heroin", plainTitle: "Heroin users draw others into heroin" },
  "si on developing hud relative": { title: "SI on developing HUD", plainTitle: "Heroin addiction spreads through peers" },
  "si on remission relative": { title: "SI on remission", plainTitle: "People in recovery affect relapse" },
  "rx availability for misuse relative": { title: "Rx availability for misuse", plainTitle: "Spare pills in circulation" },
  "heroin availability index": { title: "Heroin availability", plainTitle: "Heroin on the street (follows price)" },
  "rx vs heroin availability index": { title: "Rx vs heroin availability", plainTitle: "Pills getting scarcer than heroin" },
  "adf fraction of rx street supply net": { title: "ADF fraction of Rx street supply", plainTitle: "Harder-to-abuse pills on the street" },
};

const INPUTS: Omit<ExternalInput, "flows">[] = [
  { id: "fent", key: "fentanyl penetration curve", title: "Fentanyl penetration", plainTitle: "Fentanyl in the heroin supply", unit: "share" },
  { id: "nxkd", key: "nx kits distributed net", title: "Naloxone kits distributed", plainTitle: "Overdose-reversal kits handed out", unit: "kits/yr" },
  { id: "hpi", key: "heroin price index", title: "Heroin price index", plainTitle: "Street price of heroin (1999 = 1)", unit: "index" },
  { id: "bmdcap", key: "bup providers", title: "Buprenorphine providers", plainTitle: "Doctors allowed to prescribe buprenorphine", unit: "providers" },
  { id: "mmtcap", key: "mmt capacity estimated", title: "Methadone capacity", plainTitle: "Places in methadone clinics", unit: "people" },
  { id: "vivcap", key: "viv capacity estimated", title: "Vivitrol capacity", plainTitle: "Places on injectable naltrexone", unit: "people" },
  { id: "ptrx", key: "patients receiving opioid prescription annual", title: "Patients with opioid Rx", plainTitle: "Patients prescribed opioids", unit: "people/yr" },
  { id: "rxpp", key: "prescriptions per person", title: "Prescriptions per person", plainTitle: "Prescriptions per patient", unit: "Rx/person" },
  { id: "rxdur", key: "average days per prescription", title: "Days per prescription", plainTitle: "Days per prescription", unit: "days" },
  { id: "mme", key: "average mme per day", title: "Average MME per day", plainTitle: "Daily dose strength (morphine equiv.)", unit: "MME/day" },
  { id: "adf", key: "adf fraction of prescribed rx opioids", title: "ADF fraction", plainTitle: "Share of pills that are abuse-deterrent", unit: "share" },
];

const SEARCH_DEPTH = 5;
const TRACE_DEPTH = 14;

export function findLoops(sem: Semantics): Loop[] {
  const byDriver = new Map<string, Loop>();
  const settable = [...sem.vars.keys()].filter((key) => isStrength(key) && sem.vars.get(key)!.role !== "mechanism");
  for (const strength of settable.sort()) {
    for (const effect of traceEffect(sem, strength)) {
      const id = `${effect.family}:${effect.driver}`;
      const loop = byDriver.get(id) ?? { id, family: effect.family, driver: effect.driver, links: [], flows: [], people: [], inputs: [], driverFlows: [], feedback: false };
      const sign = /\^\s*-/.test(sem.vars.get(effect.coefficient)!.definitions[0]?.expression ?? "") ? -1 : 1;
      loop.links.push({ strength, coefficient: effect.coefficient, sign, flows: effect.flows });
      loop.flows = [...new Set([...loop.flows, ...effect.flows])];
      byDriver.set(id, loop);
    }
  }
  for (const loop of byDriver.values()) {
    const sources = traceSources(sem, loop.driver);
    loop.people = sources.people;
    loop.inputs = sources.inputs;
    loop.driverFlows = sources.flows;
    loop.feedback = sources.people.length > 0;
  }
  return [...byDriver.values()].sort((a, b) => familyOrder(a.family) - familyOrder(b.family) || b.flows.length - a.flows.length);
}

export function findInputs(sem: Semantics): ExternalInput[] {
  return INPUTS.filter((input) => sem.vars.has(input.key)).map((input) => ({ ...input, flows: downstreamFlows(sem, input.key) }));
}

// The edits that switch a loop off, in the form `WhatIf.edits` takes.
export function knockoutCells(sem: Semantics, loop: Loop): Map<number, number> {
  const cells = new Map<number, number>();
  for (const link of loop.links) for (const cell of sem.vars.get(link.strength)?.cells ?? []) cells.set(cell, 1e-6);
  return cells;
}

export function loopTitle(loop: Loop, plain: boolean): string {
  const titles = LOOP_TITLES[loop.driver];
  if (titles) return plain ? titles.plainTitle : titles.title;
  return plain ? FAMILIES[loop.family].plainTitle : loop.driver;
}

const terminalCache = new WeakMap<Semantics, Map<string, { flows: string[]; people: string[] }>>();

// The people flows and groups a variable is ultimately computed from, stopping at the first flow or
// group on each path and at external inputs.
export function upstreamTerminals(sem: Semantics, key: string): { flows: string[]; people: string[] } {
  const cache = terminalCache.get(sem) ?? new Map();
  terminalCache.set(sem, cache);
  if (cache.has(key)) return cache.get(key)!;
  const flows = new Set<string>();
  const people = new Set<string>();
  const inputKeys = new Set(INPUTS.map((i) => i.key));
  const seen = new Set([key]);
  const queue: [string, number][] = [[key, 0]];
  while (queue.length) {
    const [k, depth] = queue.shift()!;
    if (isFlow(sem, k)) {
      flows.add(k);
      continue;
    }
    if (isPeople(sem, k)) {
      people.add(k);
      continue;
    }
    if (inputKeys.has(k) || depth >= TRACE_DEPTH) continue;
    for (const u of sem.vars.get(k)!.uses) {
      if (seen.has(u)) continue;
      seen.add(u);
      queue.push([u, depth + 1]);
    }
  }
  const result = { flows: [...flows], people: [...people] };
  cache.set(key, result);
  return result;
}

export function isStrength(key: string): boolean {
  return /strength/.test(key) && !/^policy change/.test(key);
}

function familyOf(strength: string): LoopFamily | null {
  if (/^social influence/.test(strength)) return "si";
  if (/^perceived risk/.test(strength)) return "pr";
  if (/availability/.test(strength)) return "av";
  if (/^adf effect/.test(strength)) return "adf";
  return null;
}

function familyOrder(family: LoopFamily): number {
  return Object.keys(FAMILIES).indexOf(family);
}

// Walks down from a strength until the first variable that also reads something outside this chain:
// that variable is the effect's coefficient and the outside thing is its driver. A strength can be
// shared by several coefficients that each read it directly; each becomes its own effect.
function traceEffect(sem: Semantics, strength: string): { family: LoopFamily; coefficient: string; driver: string; flows: string[] }[] {
  const family = familyOf(strength);
  if (!family) return [];
  const chain = new Set([strength]);
  const order: string[] = [];
  const queue: [string, number][] = [[strength, 0]];
  while (queue.length) {
    const [key, depth] = queue.shift()!;
    for (const next of sem.vars.get(key)!.usedBy) {
      if (chain.has(next)) continue;
      chain.add(next);
      if (!isFlow(sem, next) && depth < SEARCH_DEPTH) {
        order.push(next);
        queue.push([next, depth + 1]);
      }
    }
  }
  const driverOf = (key: string) => sem.vars.get(key)!.uses.find((u) => !chain.has(u) && isDriverCandidate(sem, u));
  const direct = order.filter((key) => sem.vars.get(key)!.uses.includes(strength) && driverOf(key));
  const first = order.find((key) => driverOf(key));
  const coefficients = direct.length ? direct : first ? [first] : [];
  return coefficients
    .map((coefficient) => ({ family, coefficient, driver: driverOf(coefficient)!, flows: downstreamFlows(sem, coefficient) }))
    .filter((e) => e.flows.length);
}

function isDriverCandidate(sem: Semantics, key: string): boolean {
  const info = sem.vars.get(key)!;
  return (info.role === "mechanism" || info.role === "driver" || info.role === "stock") && !isStrength(key) && !/^policy|^time$|switch/.test(key);
}

function traceSources(sem: Semantics, driver: string): { people: string[]; inputs: string[]; flows: string[] } {
  const people = new Set<string>();
  const flows = new Set<string>();
  const inputs = new Set<string>();
  const inputKeys = new Set(INPUTS.map((i) => i.key));
  const seen = new Set([driver]);
  const queue: [string, number][] = [[driver, 0]];
  while (queue.length) {
    const [key, depth] = queue.shift()!;
    const info = sem.vars.get(key)!;
    if (isPeople(sem, key)) {
      people.add(key);
      continue;
    }
    if (inputKeys.has(key)) {
      inputs.add(key);
      continue;
    }
    if (isFlow(sem, key)) flows.add(key);
    if (depth >= TRACE_DEPTH) continue;
    for (const u of info.uses) {
      if (seen.has(u)) continue;
      seen.add(u);
      queue.push([u, depth + 1]);
    }
  }
  return { people: [...people], inputs: [...inputs], flows: [...flows] };
}

function downstreamFlows(sem: Semantics, key: string): string[] {
  const flows = new Set<string>();
  const seen = new Set([key]);
  const queue: [string, number][] = [[key, 0]];
  while (queue.length) {
    const [k, depth] = queue.shift()!;
    for (const next of sem.vars.get(k)!.usedBy) {
      if (seen.has(next)) continue;
      seen.add(next);
      if (isFlow(sem, next)) flows.add(next);
      else if (sem.vars.get(next)!.role !== "stock" && depth < TRACE_DEPTH) queue.push([next, depth + 1]);
    }
  }
  return [...flows];
}

function isFlow(sem: Semantics, key: string): boolean {
  const info = sem.vars.get(key);
  return !!info && describeFlow(sem, info) !== null;
}

function isPeople(sem: Semantics, key: string): boolean {
  const info = sem.vars.get(key);
  return info?.role === "stock" && /people|person/i.test(info.units);
}
