// Compiles parsed Vensim definitions into a fast simulator.
//
// Every subscripted variable is expanded into scalar "cells" (one per element combination),
// expressions are lowered to reference cells directly, and three JavaScript functions are
// generated: one for the initial values, one for the auxiliaries at each time step, and one
// for the Euler update of the stocks. Runs in Node and in the browser.

import type { Definition, DataMode, Range } from "./mdl.ts";
import { type Expr, parseExpression } from "./expr.ts";

export const NA = -1.298074214633707e33;

export type DataSeries = { times: number[]; values: number[] };

export type ModelSource = {
  definitions: Definition[];
  ranges: Range[];
  data: Record<string, DataSeries>;
};

export type CellKind = "const" | "data" | "aux" | "stock" | "initial" | "active-initial" | "hidden-stock";

export type Cell = {
  index: number;
  key: string;
  label: string;
  variable: string;
  kind: CellKind;
  hidden: boolean;
  defaultValue: number;
};

export type Variable = { key: string; name: string; cells: number[]; elementLabels: string[] };

export type Override = { target: string; value: number };

export type RunResult = {
  times: Float64Array;
  cellCount: number;
  values: Float64Array;
  series: (cell: number) => Float64Array;
};

export type CompiledModel = {
  cells: Cell[];
  variables: Map<string, Variable>;
  problems: string[];
  defaults: () => Float64Array;
  resolveOverride: (target: string) => number[];
  applyOverrides: (values: Float64Array, overrides: Override[]) => string[];
  simulate: (constants: Float64Array) => RunResult;
  dataPoints: (cell: number) => DataSeries | null;
};

export function compileModel(source: ModelSource): CompiledModel {
  const compiler = new Compiler(source);
  compiler.createCells();
  compiler.lowerCells();
  return compiler.finish();
}

export function cellKey(variable: string, elements: string[]): string {
  return elements.length ? `${variable}[${elements.join(",")}]` : variable;
}

export function parseCellName(name: string): { variable: string; elements: string[] } {
  const match = name.match(/^([^\[]+?)\s*(?:\[([^\]]*)\])?\s*$/);
  const variable = normalize(match?.[1] ?? name);
  const elements = match?.[2] ? match[2].split(",").map(normalize) : [];
  return { variable, elements };
}

// Expands the subscripts on the left-hand side of each definition into concrete cells.
export function expandDefinition(definition: Definition, ranges: RangeTable): { elements: string[]; bindings: Map<string, string> }[] {
  let combos: { elements: string[]; bindings: Map<string, string> }[] = [{ elements: [], bindings: new Map() }];
  for (const subscript of definition.subscripts) {
    const members = ranges.elements.get(subscript);
    combos = combos.flatMap((combo) =>
      (members ?? [subscript]).map((element) => ({
        elements: [...combo.elements, element],
        bindings: members ? new Map([...combo.bindings, [subscript, element]]) : combo.bindings,
      })),
    );
  }
  return combos;
}

export type RangeTable = { elements: Map<string, string[]>; labels: Map<string, string> };

export function buildRangeTable(ranges: Range[]): RangeTable {
  const byKey = new Map(ranges.map((r) => [r.key, r]));
  const elements = new Map<string, string[]>();
  const labels = new Map<string, string>();
  const expand = (key: string, seen: Set<string>): string[] => {
    if (elements.has(key)) return elements.get(key)!;
    const range = byKey.get(key)!;
    const out: string[] = [];
    for (const member of range.members) {
      for (const label of expandNumericMembers(member)) {
        const memberKey = normalize(label);
        if (byKey.has(memberKey) && !seen.has(memberKey)) out.push(...expand(memberKey, new Set([...seen, key])));
        else {
          out.push(memberKey);
          if (!labels.has(memberKey)) labels.set(memberKey, label);
        }
      }
    }
    elements.set(key, out);
    return out;
  };
  for (const range of ranges) expand(range.key, new Set([range.key]));
  return { elements, labels };
}

function expandNumericMembers(member: string): string[] {
  const m = member.match(/^\(\s*([A-Za-z_]*)(\d+)\s*-\s*[A-Za-z_]*(\d+)\s*\)$/);
  if (!m) return [member];
  const [, prefix, from, to] = m;
  const out: string[] = [];
  for (let n = Number(from); n <= Number(to); n++) out.push(prefix + String(n).padStart(from.length, "0"));
  return out;
}

function normalize(name: string): string {
  return name.replace(/"/g, "").toLowerCase().replace(/[_\s]+/g, " ").trim();
}

// ---------------------------------------------------------------------------

type Node =
  | { t: "num"; v: number }
  | { t: "cell"; i: number }
  | { t: "time" }
  | { t: "fn"; fn: string; args: Node[] }
  | { t: "data"; fn: "at" | "mean"; series: number; args: Node[] }
  | { t: "unary"; op: "-" | "not"; arg: Node }
  | { t: "binary"; op: string; left: Node; right: Node };

type Computation =
  | { kind: "const"; value: number }
  | { kind: "data"; series: number }
  | { kind: "aux"; expr: Node }
  | { kind: "initial"; expr: Node }
  | { kind: "active-initial"; expr: Node; init: Node }
  | { kind: "stock" | "hidden-stock"; flow: Node; init: Node };

type PendingCell = { cell: Cell; definition: Definition; bindings: Map<string, string> };

type CompiledSeries = DataSeries & { mode: DataMode };

class Compiler {
  private source: ModelSource;
  private ranges: RangeTable;
  private cells: Cell[] = [];
  private computations: Computation[] = [];
  private pending: PendingCell[] = [];
  private pendingByCell = new Map<number, PendingCell>();
  private cellByKey = new Map<string, number>();
  private variables = new Map<string, Variable>();
  private series: CompiledSeries[] = [];
  private seriesByCell = new Map<number, number>();
  private problems: string[] = [];
  private hiddenCount = 0;

  constructor(source: ModelSource) {
    this.source = source;
    this.ranges = buildRangeTable(source.ranges);
  }

  createCells() {
    for (const definition of this.source.definitions) {
      const list = constantList(definition);
      expandDefinition(definition, this.ranges).forEach(({ elements, bindings }, position) => {
        const key = cellKey(definition.key, elements);
        if (this.cellByKey.has(key)) {
          this.problems.push(`${key} is defined twice (line ${definition.line}); keeping the first definition`);
          return;
        }
        const labels = elements.map((e) => this.ranges.labels.get(e) ?? e);
        const label = labels.length ? `${definition.name}[${labels.join(",")}]` : definition.name;
        const cell = this.addCell(key, label, definition.key, "aux", false);
        if (list) {
          this.computations[cell.index] = { kind: "const", value: list[position] ?? NA };
          cell.kind = "const";
          cell.defaultValue = list[position] ?? NA;
        } else {
          this.pending.push({ cell, definition, bindings });
          this.pendingByCell.set(cell.index, { cell, definition, bindings });
        }
        const variable = this.variables.get(definition.key) ?? { key: definition.key, name: definition.name, cells: [], elementLabels: [] };
        variable.cells.push(cell.index);
        variable.elementLabels.push(labels.join(","));
        this.variables.set(definition.key, variable);
      });
    }
  }

  lowerCells() {
    for (const pending of this.pending) this.ensureComputed(pending.cell.index);
  }

  // Cells are lowered in definition order, but GET DATA calls and DELAY N orders need
  // another cell's result first, so lowering can recurse into a cell defined later.
  private ensureComputed(index: number) {
    if (this.computations[index]) return;
    const pending = this.pendingByCell.get(index);
    if (!pending) return;
    this.computations[index] = { kind: "const", value: NA };
    try {
      this.computations[index] = this.computeCell(pending);
    } catch (error) {
      this.problems.push(`${pending.cell.key} (line ${pending.definition.line}): ${(error as Error).message}`);
    }
    const computation = this.computations[index];
    pending.cell.kind = computation.kind;
    if (computation.kind === "const") pending.cell.defaultValue = computation.value;
  }

  finish(): CompiledModel {
    const program = this.generate();
    const cells = this.cells;
    const series = this.series;
    const seriesByCell = this.seriesByCell;
    const variables = this.variables;
    const cellByKey = this.cellByKey;
    const ranges = this.ranges;
    const timeCells = {
      initial: cellByKey.get("initial time"),
      final: cellByKey.get("final time"),
      step: cellByKey.get("time step"),
    };
    const helpers = runtimeHelpers(series);

    const resolveOverride = (target: string): number[] => {
      const { variable, elements } = parseCellName(target);
      if (!elements.length) return variables.get(variable)?.cells ?? [];
      let combos: string[][] = [[]];
      for (const element of elements) {
        const members = ranges.elements.get(element) ?? [element];
        combos = combos.flatMap((combo) => members.map((m) => [...combo, m]));
      }
      return combos.map((c) => cellByKey.get(cellKey(variable, c))).filter((i): i is number => i !== undefined);
    };

    return {
      cells,
      variables,
      problems: this.problems,
      defaults: () => Float64Array.from(cells, (c) => c.defaultValue),
      resolveOverride,
      applyOverrides(values, overrides) {
        const unresolved: string[] = [];
        for (const { target, value } of overrides) {
          const targets = resolveOverride(target).filter((i) => cells[i].kind === "const");
          if (!targets.length) unresolved.push(target);
          for (const i of targets) values[i] = value;
        }
        return unresolved;
      },
      simulate(constants) {
        const t0 = constants[timeCells.initial!];
        const tEnd = constants[timeCells.final!];
        const dt = constants[timeCells.step!];
        const steps = Math.round((tEnd - t0) / dt) + 1;
        const n = cells.length;
        const data = series.map((s) => sampleSeries(s, t0, dt, steps));
        const v = Float64Array.from(constants);
        const out = new Float64Array(steps * n);
        const times = new Float64Array(steps);
        program.init(v, data, helpers, NA, t0, dt, 0);
        out.set(v, 0);
        times[0] = t0;
        for (let s = 1; s < steps; s++) {
          program.flows(v, data, helpers, NA, t0 + (s - 1) * dt, dt, s - 1);
          const t = t0 + s * dt;
          program.aux(v, data, helpers, NA, t, dt, s);
          out.set(v, s * n);
          times[s] = t;
        }
        return {
          times,
          cellCount: n,
          values: out,
          series(cell) {
            const result = new Float64Array(steps);
            for (let s = 0; s < steps; s++) result[s] = out[s * n + cell];
            return result;
          },
        };
      },
      dataPoints(cell) {
        const index = seriesByCell.get(cell);
        return index === undefined ? null : series[index];
      },
    };
  }

  // -------------------------------------------------------------------------
  // Turning one definition into a computation

  private computeCell({ cell, definition, bindings }: PendingCell): Computation {
    if (definition.kind === "data") {
      const points = this.source.data[cell.key];
      if (points && points.times.length) {
        this.seriesByCell.set(cell.index, this.series.length);
        this.series.push({ ...points, mode: definition.dataMode });
        return { kind: "data", series: this.series.length - 1 };
      }
      if (!definition.expression) {
        this.problems.push(`${cell.key}: no data points found`);
        return { kind: "const", value: NA };
      }
    }
    const expr = parseExpression(definition.expression);
    if (expr.type === "num") return { kind: "const", value: expr.value };
    if (expr.type === "na") return { kind: "const", value: NA };
    if (expr.type === "unary" && expr.op === "-" && expr.arg.type === "num") return { kind: "const", value: -expr.arg.value };
    const context: Context = { bindings, owner: cell };
    if (expr.type === "call" && expr.fn === "INTEG") {
      return { kind: "stock", flow: this.lower(expr.args[0], context), init: this.lower(expr.args[1], context) };
    }
    if (expr.type === "call" && expr.fn === "INITIAL") return { kind: "initial", expr: this.lower(expr.args[0], context) };
    if (expr.type === "call" && expr.fn === "ACTIVE INITIAL") {
      return { kind: "active-initial", expr: this.lower(expr.args[0], context), init: this.lower(expr.args[1], context) };
    }
    const lowered = this.lower(expr, context);
    if (!containsDynamic(lowered)) return { kind: "const", value: evaluateStatic(lowered, this.cells) };
    return { kind: "aux", expr: lowered };
  }

  private lower(expr: Expr, context: Context): Node {
    switch (expr.type) {
      case "num":
        return { t: "num", v: expr.value };
      case "na":
        return { t: "num", v: NA };
      case "ref":
        return this.lowerRef(expr, context);
      case "unary":
        return { t: "unary", op: expr.op, arg: this.lower(expr.arg, context) };
      case "binary":
        return { t: "binary", op: expr.op, left: this.lower(expr.left, context), right: this.lower(expr.right, context) };
      case "call":
        return this.lowerCall(expr.fn, expr.args, context);
    }
  }

  private lowerRef(expr: Extract<Expr, { type: "ref" }>, context: Context): Node {
    if (expr.key === "time") return { t: "time" };
    const elements = expr.subscripts.map((s) => this.resolveSubscript(s.key, context));
    const key = cellKey(expr.key, elements);
    const index = this.cellByKey.get(key);
    if (index === undefined) throw new Error(`unknown reference ${key}`);
    return { t: "cell", i: index };
  }

  private resolveSubscript(subscript: string, context: Context): string {
    const bound = context.bindings.get(subscript);
    if (bound) return bound;
    const members = this.ranges.elements.get(subscript);
    if (!members) return subscript;
    for (const element of context.bindings.values()) if (members.includes(element)) return element;
    throw new Error(`cannot map subscript range ${subscript}`);
  }

  private lowerCall(fn: string, args: Expr[], context: Context): Node {
    const lowerArgs = () => args.map((a) => this.lower(a, context));
    switch (fn) {
      case "IF THEN ELSE":
        return { t: "fn", fn: "if", args: lowerArgs() };
      case "MIN":
      case "MAX":
      case "EXP":
      case "LN":
      case "ABS":
      case "SQRT":
      case "INTEGER":
      case "ZIDZ":
      case "XIDZ":
      case "MODULO":
      case "GAMMA LN":
      case "X IF MISSING":
      case "RAMP":
      case "STEP":
      case "PULSE":
        return { t: "fn", fn, args: lowerArgs() };
      case "SUM":
        return this.lowerSum(args[0], context);
      case "INITIAL":
        return this.hidden(context, "INITIAL", { kind: "initial", expr: this.lower(args[0], context) });
      case "ACTIVE INITIAL":
        return this.hidden(context, "ACTIVE INITIAL", {
          kind: "active-initial",
          expr: this.lower(args[0], context),
          init: this.lower(args[1], context),
        });
      case "INTEG":
        return this.hidden(context, "INTEG", { kind: "hidden-stock", flow: this.lower(args[0], context), init: this.lower(args[1], context) });
      case "SMOOTH":
      case "SMOOTHI":
        return this.lowerSmooth(args, context);
      case "DELAY1":
      case "DELAY1I":
      case "DELAY3":
      case "DELAY3I":
      case "DELAY N":
        return this.lowerDelay(fn, args, context);
      case "GET DATA LAST TIME":
        return { t: "num", v: this.dataSeriesFor(args[0], context).times.at(-1)! };
      case "GET DATA AT TIME":
        return { t: "data", fn: "at", series: this.dataSeriesIndex(args[0], context), args: [this.lower(args[1], context)] };
      case "GET DATA MEAN":
        return {
          t: "data",
          fn: "mean",
          series: this.dataSeriesIndex(args[0], context),
          args: [this.lower(args[1], context), this.lower(args[2], context)],
        };
      default:
        throw new Error(`unsupported function ${fn}`);
    }
  }

  private lowerSum(arg: Expr, context: Context): Node {
    const bangs = [...new Set(collectBangs(arg))];
    let combos: Map<string, string>[] = [new Map(context.bindings)];
    for (const range of bangs) {
      const members = this.ranges.elements.get(range);
      if (!members) throw new Error(`unknown range ${range} in SUM`);
      combos = combos.flatMap((b) => members.map((m) => new Map([...b, [range, m]])));
    }
    return combos
      .map((bindings) => this.lower(arg, { ...context, bindings }))
      .reduce((left, right) => ({ t: "binary", op: "+", left, right }));
  }

  private lowerSmooth(args: Expr[], context: Context): Node {
    const input = this.lower(args[0], context);
    const delay = this.lower(args[1], context);
    const init = args[2] ? this.lower(args[2], context) : input;
    const stock = this.addHiddenCell(context, "SMOOTH");
    this.computations[stock.index] = {
      kind: "hidden-stock",
      flow: { t: "binary", op: "/", left: { t: "binary", op: "-", left: input, right: { t: "cell", i: stock.index } }, right: delay },
      init,
    };
    return { t: "cell", i: stock.index };
  }

  // A material delay of order n is a chain of n stocks, each draining at rate n / delay.
  private lowerDelay(fn: string, args: Expr[], context: Context): Node {
    const input = this.lower(args[0], context);
    const delay = this.lower(args[1], context);
    const orderByFn: Record<string, number> = { DELAY1: 1, DELAY1I: 1, DELAY3: 3, DELAY3I: 3 };
    const order = fn === "DELAY N" ? this.staticValue(this.lower(args[3], context)) : orderByFn[fn];
    const initialOutflow = args[2] ? this.lower(args[2], context) : input;
    const stageTime: Node = { t: "binary", op: "/", left: delay, right: { t: "num", v: order } };
    let inflow = input;
    let outflow: Node = input;
    for (let k = 0; k < order; k++) {
      const stage = this.addHiddenCell(context, `${fn} stage ${k + 1}`);
      outflow = { t: "binary", op: "/", left: { t: "cell", i: stage.index }, right: stageTime };
      this.computations[stage.index] = {
        kind: "hidden-stock",
        flow: { t: "binary", op: "-", left: inflow, right: outflow },
        init: { t: "binary", op: "*", left: initialOutflow, right: stageTime },
      };
      inflow = outflow;
    }
    return outflow;
  }

  private hidden(context: Context, label: string, computation: Computation): Node {
    const cell = this.addHiddenCell(context, label);
    this.computations[cell.index] = computation;
    return { t: "cell", i: cell.index };
  }

  private addHiddenCell(context: Context, label: string): Cell {
    const owner = context.owner;
    const kind: CellKind = label.startsWith("INITIAL") ? "initial" : label.startsWith("ACTIVE") ? "active-initial" : "hidden-stock";
    return this.addCell(`${owner.key}#${++this.hiddenCount}`, `${label} in ${owner.label}`, owner.variable, kind, true);
  }

  private addCell(key: string, label: string, variable: string, kind: CellKind, hidden: boolean): Cell {
    const cell: Cell = { index: this.cells.length, key, label, variable, kind, hidden, defaultValue: 0 };
    this.cells.push(cell);
    this.cellByKey.set(key, cell.index);
    return cell;
  }

  private dataSeriesIndex(arg: Expr, context: Context): number {
    const node = this.lower(arg, context);
    if (node.t === "cell") this.ensureComputed(node.i);
    const index = node.t === "cell" ? this.seriesByCell.get(node.i) : undefined;
    if (index === undefined) throw new Error("GET DATA function needs a data variable");
    return index;
  }

  private dataSeriesFor(arg: Expr, context: Context): DataSeries {
    return this.series[this.dataSeriesIndex(arg, context)];
  }

  private staticValue(node: Node): number {
    for (const i of cellRefs(node)) this.ensureComputed(i);
    return evaluateStatic(node, this.cells);
  }

  // -------------------------------------------------------------------------
  // Ordering and code generation

  private generate() {
    const initOrder = this.order(["aux", "active-initial", "initial", "stock", "hidden-stock"], (c) => {
      const comp = this.computations[c];
      if (comp.kind === "aux" || comp.kind === "initial") return comp.expr;
      if (comp.kind === "active-initial" || comp.kind === "stock" || comp.kind === "hidden-stock") return comp.init;
      return null;
    });
    const auxOrder = this.order(["aux", "active-initial"], (c) => {
      const comp = this.computations[c];
      return comp.kind === "aux" || comp.kind === "active-initial" ? comp.expr : null;
    });

    const dataLines = this.cells
      .filter((c) => this.computations[c.index].kind === "data")
      .map((c) => `v[${c.index}]=D[${(this.computations[c.index] as { series: number }).series}][s];`);

    const initLines = initOrder.map((i) => {
      const comp = this.computations[i];
      const node = comp.kind === "aux" || comp.kind === "initial" ? comp.expr : (comp as { init: Node }).init;
      return `v[${i}]=${gen(node)};`;
    });
    const auxLines = auxOrder.map((i) => `v[${i}]=${gen((this.computations[i] as { expr: Node }).expr)};`);
    const stocks = this.cells.filter((c) => ["stock", "hidden-stock"].includes(this.computations[c.index].kind));
    const flowLines = [
      ...stocks.map((c, k) => `const f${k}=${gen((this.computations[c.index] as { flow: Node }).flow)};`),
      ...stocks.map((c, k) => `v[${c.index}]+=dt*f${k};`),
    ];

    const params = ["v", "D", "F", "NA", "t", "dt", "s"];
    type Step = (v: Float64Array, D: Float64Array[], F: Helpers, na: number, t: number, dt: number, s: number) => void;
    return {
      init: new Function(...params, [...dataLines, ...initLines].join("\n")) as Step,
      aux: new Function(...params, [...dataLines, ...auxLines].join("\n")) as Step,
      flows: new Function(...params, flowLines.join("\n")) as Step,
    };
  }

  private order(kinds: CellKind[], exprOf: (cell: number) => Node | null): number[] {
    const included = new Set(this.cells.filter((c) => kinds.includes(this.computations[c.index].kind)).map((c) => c.index));
    const state = new Map<number, "visiting" | "done">();
    const result: number[] = [];
    const visit = (i: number, path: number[]) => {
      if (state.get(i) === "done") return;
      if (state.get(i) === "visiting") {
        const cycle = path.slice(path.indexOf(i)).map((c) => this.cells[c].label);
        this.problems.push(`cycle: ${cycle.join(" -> ")}`);
        return;
      }
      state.set(i, "visiting");
      const expr = exprOf(i);
      if (expr) for (const dep of cellRefs(expr)) if (included.has(dep)) visit(dep, [...path, i]);
      state.set(i, "done");
      result.push(i);
    };
    for (const i of included) visit(i, []);
    return result;
  }
}

type Context = { bindings: Map<string, string>; owner: Cell };

// Subscripted constants can be written as a list, e.g. "x[TxT] = 0.7, 0.66, 0.3" (rows separated by ";").
function constantList(definition: Definition): number[] | null {
  if (definition.kind !== "equation" || !/[,;]/.test(definition.expression)) return null;
  const parts = definition.expression.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  const values = parts.map(Number);
  return values.every((v) => !Number.isNaN(v)) ? values : null;
}

function collectBangs(expr: Expr): string[] {
  if (expr.type === "ref") return expr.subscripts.filter((s) => s.bang).map((s) => s.key);
  if (expr.type === "call") return expr.args.flatMap(collectBangs);
  if (expr.type === "unary") return collectBangs(expr.arg);
  if (expr.type === "binary") return [...collectBangs(expr.left), ...collectBangs(expr.right)];
  return [];
}

function cellRefs(node: Node, into: number[] = []): number[] {
  if (node.t === "cell") into.push(node.i);
  if (node.t === "fn" || node.t === "data") node.args.forEach((a) => cellRefs(a, into));
  if (node.t === "unary") cellRefs(node.arg, into);
  if (node.t === "binary") {
    cellRefs(node.left, into);
    cellRefs(node.right, into);
  }
  return into;
}

function containsDynamic(node: Node): boolean {
  if (node.t === "cell" || node.t === "time" || node.t === "data") return true;
  if (node.t === "fn") return ["RAMP", "STEP", "PULSE"].includes(node.fn) || node.args.some(containsDynamic);
  if (node.t === "unary") return containsDynamic(node.arg);
  if (node.t === "binary") return containsDynamic(node.left) || containsDynamic(node.right);
  return false;
}

function evaluateStatic(node: Node, cells: Cell[]): number {
  const body = `return ${gen(node)};`;
  const values = Float64Array.from(cells, (c) => c.defaultValue);
  return new Function("v", "F", "NA", body)(values, runtimeHelpers([]), NA);
}

function gen(node: Node): string {
  switch (node.t) {
    case "num":
      return node.v === NA ? "NA" : node.v < 0 ? `(${node.v})` : String(node.v);
    case "cell":
      return `v[${node.i}]`;
    case "time":
      return "t";
    case "unary":
      return node.op === "-" ? `(-${gen(node.arg)})` : `(${gen(node.arg)}===0?1:0)`;
    case "binary":
      return genBinary(node.op, gen(node.left), gen(node.right));
    case "data":
      return node.fn === "at" ? `F.dataAt(${node.series},${gen(node.args[0])})` : `F.dataMean(${node.series},${gen(node.args[0])},${gen(node.args[1])})`;
    case "fn":
      return genCall(node.fn, node.args.map(gen));
  }
}

function genBinary(op: string, a: string, b: string): string {
  switch (op) {
    case "^":
      return `Math.pow(${a},${b})`;
    case "=":
      return `(${a}===${b}?1:0)`;
    case "<>":
      return `(${a}!==${b}?1:0)`;
    case "<":
    case ">":
    case "<=":
    case ">=":
      return `(${a}${op}${b}?1:0)`;
    case "and":
      return `(${a}!==0&&${b}!==0?1:0)`;
    case "or":
      return `(${a}!==0||${b}!==0?1:0)`;
    default:
      return `(${a}${op}${b})`;
  }
}

function genCall(fn: string, a: string[]): string {
  switch (fn) {
    case "if":
      return `(${a[0]}!==0?${a[1]}:${a[2]})`;
    case "MIN":
      return `Math.min(${a.join(",")})`;
    case "MAX":
      return `Math.max(${a.join(",")})`;
    case "EXP":
      return `Math.exp(${a[0]})`;
    case "LN":
      return `Math.log(${a[0]})`;
    case "ABS":
      return `Math.abs(${a[0]})`;
    case "SQRT":
      return `Math.sqrt(${a[0]})`;
    case "INTEGER":
      return `Math.trunc(${a[0]})`;
    case "ZIDZ":
      return `F.zidz(${a[0]},${a[1]})`;
    case "XIDZ":
      return `F.xidz(${a[0]},${a[1]},${a[2]})`;
    case "MODULO":
      return `F.modulo(${a[0]},${a[1]})`;
    case "GAMMA LN":
      return `F.gammaLn(${a[0]})`;
    case "X IF MISSING":
      return `(${a[0]}===NA?${a[1]}:${a[0]})`;
    case "RAMP":
      return `F.ramp(t,${a[0]},${a[1]},${a[2]})`;
    case "STEP":
      return `F.step(t,dt,${a[0]},${a[1]})`;
    case "PULSE":
      return `F.pulse(t,dt,${a[0]},${a[1]})`;
    default:
      throw new Error(`no code generator for ${fn}`);
  }
}

// ---------------------------------------------------------------------------
// Runtime

type Helpers = ReturnType<typeof runtimeHelpers>;

function runtimeHelpers(series: CompiledSeries[]) {
  return {
    zidz: (a: number, b: number) => (b === 0 ? 0 : a / b),
    xidz: (a: number, b: number, x: number) => (b === 0 ? x : a / b),
    modulo: (a: number, b: number) => a - b * Math.floor(a / b),
    ramp: (t: number, slope: number, start: number, end: number) => (t > start ? (t < end ? slope * (t - start) : slope * (end - start)) : 0),
    step: (t: number, dt: number, height: number, at: number) => (t + dt / 2 > at ? height : 0),
    pulse: (t: number, dt: number, start: number, width: number) => {
      const w = width === 0 ? dt : width;
      return t + dt / 2 > start && t + dt / 2 < start + w ? 1 : 0;
    },
    gammaLn,
    dataAt: (index: number, t: number) => valueAt(series[index], t),
    dataMean: (index: number, from: number, to: number) => {
      const s = series[index];
      let sum = 0;
      let count = 0;
      for (let k = 0; k < s.times.length; k++) {
        if (s.times[k] >= from && s.times[k] <= to && s.values[k] !== NA) {
          sum += s.values[k];
          count++;
        }
      }
      return count ? sum / count : NA;
    },
  };
}

function sampleSeries(series: CompiledSeries, t0: number, dt: number, steps: number): Float64Array {
  const out = new Float64Array(steps);
  for (let s = 0; s < steps; s++) out[s] = valueAt(series, t0 + s * dt);
  return out;
}

function valueAt(series: CompiledSeries, t: number): number {
  const { times, values, mode } = series;
  const eps = 1e-9;
  if (mode === "raw") {
    for (let k = 0; k < times.length; k++) if (Math.abs(times[k] - t) < eps) return values[k];
    return NA;
  }
  if (t <= times[0] + eps) return values[0];
  const last = times.length - 1;
  if (t >= times[last] - eps) {
    if (mode !== "extrapolate" || last === 0 || t - times[last] < eps) return values[last];
    const slope = (values[last] - values[last - 1]) / (times[last] - times[last - 1]);
    return values[last] + slope * (t - times[last]);
  }
  let k = 1;
  while (times[k] < t - eps) k++;
  if (Math.abs(times[k] - t) < eps) return values[k];
  if (mode === "hold backward") return values[k - 1];
  if (mode === "look forward") return values[k];
  const f = (t - times[k - 1]) / (times[k] - times[k - 1]);
  return values[k - 1] + f * (values[k] - values[k - 1]);
}

function gammaLn(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - gammaLn(1 - x);
  const z = x - 1;
  let a = c[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}
