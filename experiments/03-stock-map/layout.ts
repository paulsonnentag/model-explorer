// Lays out every group of people in the model without the modelers' drawing: columns are stages of
// addiction, rows are which opioids people use, both read from the stock's name. Flows become edges;
// flows taking the same path for the same reason are merged into one.

import { peopleFlows, type PeopleFlow } from "../shared/flows.ts";
import type { Semantics } from "../shared/semantics.ts";

export type EdgeKind = "starts" | "progression" | "treatment" | "leaves-treatment" | "recovery" | "relapse" | "quits" | "death";

export type MapNode = { key: string; name: string; stage: number; substance: number; x: number; y: number };

export type MapEdge = { id: string; from: string | null; to: string | null; kind: EdgeKind; flows: PeopleFlow[] };

export type MapLayout = { nodes: MapNode[]; edges: MapEdge[]; width: number; height: number };

export const STAGES = ["Misuse", "Use disorder, untreated", "In treatment (MOUD)", "Remission", "Stable remission"];
export const SUBSTANCES = ["Prescription opioids only", "Prescription opioids + heroin", "Heroin"];

export const EDGE_KINDS: Record<EdgeKind, { label: string; color: string }> = {
  starts: { label: "Starts using", color: "#7c6fb0" },
  progression: { label: "Gets worse (disorder, heroin)", color: "#c2410c" },
  treatment: { label: "Enters treatment", color: "#15803d" },
  "leaves-treatment": { label: "Drops out of treatment", color: "#a16207" },
  recovery: { label: "Recovers or stops heroin", color: "#0e7490" },
  relapse: { label: "Relapses", color: "#be185d" },
  quits: { label: "Stops using", color: "#8a8f98" },
  death: { label: "Dies", color: "#1f2328" },
};

export const NODE_W = 184;
export const NODE_H = 76;
export const COL_W = 280;
export const ROW_H = 240;
export const LEFT = 210;
export const TOP = 160;

export function layoutStockMap(sem: Semantics): MapLayout {
  const flows = peopleFlows(sem);
  const keys = [...new Set(flows.flatMap((f) => [f.from, f.to]).filter((k): k is string => k !== null))];
  const nodes = keys.map((key) => {
    const name = sem.vars.get(key)!.name;
    const stage = stageOf(key);
    const substance = substanceOf(key);
    return { key, name, stage, substance, x: LEFT + stage * COL_W, y: TOP + substance * ROW_H };
  });
  return { nodes, edges: mergeEdges(flows), width: LEFT * 2 + (STAGES.length - 1) * COL_W, height: TOP + (SUBSTANCES.length - 1) * ROW_H + 140 };
}

function stageOf(key: string): number {
  if (/stable remission/.test(key)) return 4;
  if (/remission/.test(key)) return 3;
  if (/by moud/.test(key)) return 2;
  if (/no moud/.test(key)) return 1;
  return 0;
}

function substanceOf(key: string): number {
  if (/with (py )?heroin/.test(key)) return 1;
  if (/^rx/.test(key)) return 0;
  return 2;
}

function mergeEdges(flows: PeopleFlow[]): MapEdge[] {
  const byPath = new Map<string, MapEdge>();
  for (const flow of flows) {
    const kind = kindOf(flow);
    const id = `${flow.from ?? "outside"}|${flow.to ?? flow.exit}|${kind}`;
    const edge = byPath.get(id) ?? { id, from: flow.from, to: flow.to, kind, flows: [] };
    edge.flows.push(flow);
    byPath.set(id, edge);
  }
  return [...byPath.values()];
}

function kindOf(flow: PeopleFlow): EdgeKind {
  if (!flow.from) return "starts";
  if (flow.exit === "death") return "death";
  if (flow.exit === "quit") return "quits";
  if (/tx engagement/.test(flow.key)) return "treatment";
  if (/tx exit with ud/.test(flow.key)) return "leaves-treatment";
  if (/relaps/.test(flow.key)) return "relapse";
  if (/remit|remission|stabiliz|quitting/.test(flow.key)) return "recovery";
  return "progression";
}
