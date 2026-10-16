// Parses one Vensim sketch view: the stock-and-flow diagram the modelers drew, with positions.
//
// Object lines (coordinates are centres; w and h are half-sizes):
//   10,id,name,x,y,w,h,shape,bits,hidden,…   a variable; shape 3 is a stock box; even bits mark a shadow copy
//   11,id,_,x,y,w,h,…                       a flow valve; the flow's name is the variable with the next id
//   12,id,48,x,y,…                          a cloud: the source or sink of a flow outside the model
//   1,id,from,to,shape,hidden,_,thickness,…|(x,y)|…   a connector; thickness 22 is a pipe, otherwise an
//                                                     information arrow whose point bends the curve

export type SketchObject = {
  id: number;
  kind: "stock" | "flow" | "valve" | "variable" | "cloud";
  name: string;
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shadow: boolean;
};

export type SketchLink = {
  id: number;
  kind: "pipe" | "arrow";
  from: number;
  to: number;
  arrowhead: boolean;
  points: [number, number][];
};

export type SketchGeometry = { objects: SketchObject[]; links: SketchLink[] };

const PIPE_THICKNESS = 22;
const STOCK_SHAPE = 3;
const CLOUD_ICON = "48";
const NO_ARROWHEAD = 100;

export function parseSketchView(lines: string[], normalize: (name: string) => string): SketchGeometry {
  const objects: SketchObject[] = [];
  const links: SketchLink[] = [];
  let previousValve: SketchObject | null = null;
  for (const line of lines) {
    const fields = splitFields(line);
    const type = fields[0];
    const id = Number(fields[1]);
    if (type === "10") {
      const [x, y, w, h, shape, bits, hidden] = fields.slice(3, 10).map(Number);
      if (hidden === 1) continue;
      const name = fields[2];
      const isFlowName = previousValve !== null && previousValve.id === id - 1;
      const kind = shape === STOCK_SHAPE ? "stock" : isFlowName ? "flow" : "variable";
      const object: SketchObject = { id, kind, name, key: normalize(name), x, y, w, h, shadow: (bits & 1) === 0 };
      if (isFlowName) {
        previousValve!.name = name;
        previousValve!.key = object.key;
      }
      objects.push(object);
    } else if (type === "11") {
      const [x, y, w, h] = fields.slice(3, 7).map(Number);
      const valve: SketchObject = { id, kind: "valve", name: "", key: "", x, y, w, h, shadow: false };
      objects.push(valve);
      previousValve = valve;
      continue;
    } else if (type === "12" && fields[2] === CLOUD_ICON) {
      const [x, y, w, h] = fields.slice(3, 7).map(Number);
      objects.push({ id, kind: "cloud", name: "", key: "", x, y, w, h, shadow: false });
    } else if (type === "1") {
      const [from, to, shape, hidden, , thickness] = fields.slice(2, 8).map(Number);
      const pipe = thickness === PIPE_THICKNESS;
      if (hidden === 1 && !pipe) continue;
      const points = [...line.matchAll(/\((-?\d+),(-?\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
      links.push({ id, kind: pipe ? "pipe" : "arrow", from, to, arrowhead: shape !== NO_ARROWHEAD, points });
    }
    previousValve = null;
  }
  return { objects, links };
}

// Splits a sketch line on commas, keeping quoted names (which may contain commas) intact.
function splitFields(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      fields.push(current);
      current = "";
    } else current += ch;
  }
  fields.push(current);
  return fields;
}
