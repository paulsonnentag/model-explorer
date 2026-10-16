// Reads a finding from its Markdown file in opioid-model/findings/. The front matter says where it is
// in which paper, and optionally how to trace it: `trace` lists panels to open after the finding, as in
// a URL ("source:model.mdl>var:x → map>flow:y"), `trace run` names the run to apply while tracing, and
// `trace year` the year to show.
// The body has the claim, the quote, and list sections for the runs, charts and measures, written in a
// few fixed phrases so the file stays readable:
//
//   ## Runs      - **Without fentanyl** (history NoFentHist): note      also: future Pos, policy RxRate 50
//   ## Charts    - **Label**: a + b; data c; change from 2020          also: from 2015
//   ## Measures  - **Label**: a in 2020; difference                    also: at end, summed to 2021,
//                                                                       peak of a, largest drop in a; percent

export type Alternative = { id: string; label: string; note: string; future?: string; history?: string; policy?: string; strength?: "10" | "20" | "50" };

export type Chart = { label: string; keys: string[]; data: string[]; relative: boolean; from?: number };

export type Measure = {
  label: string;
  kind: "at" | "summed" | "peak" | "drop";
  keys: string[];
  year?: number;
  compare?: "difference" | "percent";
};

export type Anchor = { page: number; text: string };

export type Finding = {
  id: string;
  file: string;
  number: number;
  title: string;
  paper: string;
  anchors: Anchor[];
  source: string;
  loops: string[];
  trace: string[];
  traceRun?: string;
  traceYear?: number;
  claim: string;
  quote: string;
  runs: Alternative[];
  charts: Chart[];
  measures: Measure[];
  paperNumbers: string;
  caveat: string;
};

export function parseFinding(file: string, raw: string, number: number): Finding {
  const text = raw.replace(/\r\n?/g, "\n");
  const [, front = "", body = text] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  const meta = Object.fromEntries(front.split("\n").map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]));
  const [intro, ...sections] = body.split(/^## /m);
  const section = (name: string) => sections.find((s) => s.startsWith(`${name}\n`))?.slice(name.length).trim() ?? "";
  const items = (name: string) => section(name).split("\n").flatMap((line) => line.match(/^- \*\*(.+?)\*\*(?: \((.+?)\))?: (.*)$/)?.slice(1) ?? []);
  return {
    id: file.split("/").pop()!.replace(/^\d+-/, "").replace(/\.md$/, ""),
    file,
    number,
    title: meta.title ?? file,
    paper: meta.paper ?? "",
    anchors: list(meta.anchors).map((a) => ({ page: Number(a.split(" ")[0]), text: a.slice(a.indexOf(" ") + 1) })),
    source: meta.source ?? "",
    loops: list(meta.loops, ","),
    trace: list(meta.trace, "→"),
    traceRun: meta["trace run"] ? slug(meta["trace run"]) : undefined,
    traceYear: Number(meta["trace year"]) || undefined,
    claim: paragraphs(intro).find((p) => !p.startsWith(">")) ?? "",
    quote: paragraphs(intro).find((p) => p.startsWith(">"))?.replace(/^>\s?/gm, "") ?? "",
    runs: chunks(items("Runs"), 3).map(([label, options, note]) => run(label, options, note)),
    charts: chunks(items("Charts"), 3).map(([label, , spec]) => chart(label, spec)),
    measures: chunks(items("Measures"), 3).map(([label, , spec]) => measure(label, spec)),
    paperNumbers: section("Paper"),
    caveat: section("Caveat"),
  };
}

function run(label: string, options: string | undefined, note: string): Alternative {
  const alt: Alternative = { id: slug(label), label, note };
  for (const option of list(options, ",")) {
    const [word, name, strength] = option.split(" ");
    if (word === "future") alt.future = name;
    if (word === "history") alt.history = name;
    if (word === "policy") [alt.policy, alt.strength] = [name, (strength ?? "20") as Alternative["strength"]];
  }
  return alt;
}

function chart(label: string, spec: string): Chart {
  const [expr, ...clauses] = spec.split(";").map((s) => s.trim());
  const clause = (word: string) => clauses.find((c) => c.startsWith(`${word} `))?.slice(word.length + 1);
  const change = clause("change from");
  return { label, keys: terms(expr), data: terms(clause("data") ?? ""), relative: change !== undefined, from: Number(change ?? clause("from")) || undefined };
}

function measure(label: string, spec: string): Measure {
  const [expr, compare] = spec.split(";").map((s) => s.trim());
  const base = { label, compare: compare as Measure["compare"] };
  const peak = expr.match(/^peak of (.+)$/);
  if (peak) return { ...base, kind: "peak", keys: terms(peak[1]) };
  const drop = expr.match(/^largest drop in (.+)$/);
  if (drop) return { ...base, kind: "drop", keys: terms(drop[1]) };
  const summed = expr.match(/^(.+) summed to (\d+)$/);
  if (summed) return { ...base, kind: "summed", keys: terms(summed[1]), year: Number(summed[2]) };
  const at = expr.match(/^(.+) (?:in (\d+)|at end)$/)!;
  return { ...base, kind: "at", keys: terms(at[1]), year: at[2] ? Number(at[2]) : Infinity };
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function terms(expr: string): string[] {
  return expr ? expr.split(" + ").map((t) => t.trim()) : [];
}

function list(value: string | undefined, separator = "|"): string[] {
  return value ? value.split(separator).map((s) => s.trim()).filter(Boolean) : [];
}

function paragraphs(text: string): string[] {
  return text.trim().split(/\n\s*\n/).map((p) => p.trim());
}

function chunks<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, i * size + size));
}
