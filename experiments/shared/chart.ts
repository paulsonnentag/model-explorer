// Small SVG charts for time series. Values beyond ±1e30 are Vensim's "missing" marker and are drawn as gaps.

export type Line = { values: ArrayLike<number>; color: string; dash?: string; width?: number; label?: string };
export type Points = { times: number[]; values: number[]; color: string; label?: string };
export type Marker = { time: number; label: string };
export type Band = { lower: ArrayLike<number>; upper: ArrayLike<number>; color: string };

export function sparkline(times: ArrayLike<number>, lines: Line[], width: number, height: number, points: Points[] = []): string {
  const domain = yDomain(lines, points);
  if (!domain) return `<svg class="spark" width="${width}" height="${height}"></svg>`;
  const x = scale(times[0], times[times.length - 1], 1, width - 1);
  const y = scale(domain[0], domain[1], height - 2, 2);
  const paths = lines.map((l) => path(times, l, x, y)).join("");
  const dots = points.flatMap((p) => p.times.map((t, i) => `<circle cx="${x(t).toFixed(1)}" cy="${y(p.values[i]).toFixed(1)}" r="1.4" fill="${p.color}"/>`)).join("");
  const main = lines[lines.length - 1];
  return `<svg class="spark" width="${width}" height="${height}">${paths}${dots}${main ? nowDot(times, main.values, x, y, main.color) : ""}</svg>`;
}

// Moves every sparkline's dot under `root` to `time`, along the curve it was drawn on.
export function placeNowDots(root: ParentNode, time: number) {
  root.querySelectorAll<SVGCircleElement>("circle.now").forEach((dot) => {
    const [t0, t1, x0, x1] = dot.dataset.span!.split(" ").map(Number);
    const ys = dot.dataset.ys!.split(" ");
    const share = Math.max(0, Math.min(1, (time - t0) / (t1 - t0)));
    const y = ys[Math.round(share * (ys.length - 1))];
    dot.style.display = y ? "" : "none";
    dot.setAttribute("cx", (x0 + share * (x1 - x0)).toFixed(1));
    if (y) dot.setAttribute("cy", y);
  });
}

// Areas stacked on each other, for the parts that make up a total (e.g. one stock per medication).
export function stackedSparkline(times: ArrayLike<number>, parts: { values: ArrayLike<number>; color: string }[], width: number, height: number): string {
  const totals = Array.from({ length: times.length }, (_, i) => parts.reduce((sum, p) => sum + (p.values[i] || 0), 0));
  const hi = Math.max(0, ...totals);
  if (!(hi > 0)) return `<svg class="spark" width="${width}" height="${height}"></svg>`;
  const x = scale(times[0], times[times.length - 1], 1, width - 1);
  const y = scale(0, hi, height - 1, 2);
  let lower: number[] = Array.from({ length: times.length }, () => 0);
  const areas = parts.map((p) => {
    const upper = lower.map((v, i) => v + (p.values[i] || 0));
    const d = area(times, { lower, upper, color: p.color }, x, y, 1);
    lower = upper;
    return d;
  });
  return `<svg class="spark" width="${width}" height="${height}">${areas.join("")}${nowDot(times, totals, x, y, parts[0]?.color ?? "#1f2328")}</svg>`;
}

// A dot that marks the current year on a sparkline, hidden until placeNowDots puts it on the curve: it
// carries the curve's height at every time step, so it can follow the year without a redraw.
function nowDot(times: ArrayLike<number>, values: ArrayLike<number>, x: (v: number) => number, y: (v: number) => number, color: string): string {
  if (times.length < 2) return "";
  const last = times[times.length - 1];
  const ys = Array.from(values, (v) => (isMissing(v) ? "" : y(v).toFixed(1))).join(" ");
  return `<circle class="now" r="2.4" fill="${color}" stroke="#fff" stroke-width="1" style="display:none" data-span="${times[0]} ${last} ${x(times[0]).toFixed(1)} ${x(last).toFixed(1)}" data-ys="${ys}"/>`;
}

export function chart(options: {
  times: ArrayLike<number>;
  lines: Line[];
  points?: Points[];
  markers?: Marker[];
  bands?: Band[];
  width: number;
  height: number;
}): string {
  const { times, lines, points = [], markers = [], bands = [], width, height } = options;
  const margin = { left: 52, right: 16, top: 10, bottom: 22 };
  const domain = yDomain(lines, points);
  if (!domain) return `<div class="muted">No values to plot.</div>`;
  const [lo, hi] = niceDomain(domain);
  const x = scale(times[0], times[times.length - 1], margin.left, width - margin.right);
  const y = scale(lo, hi, height - margin.bottom, margin.top);
  const yTicks = ticks(lo, hi, 4);
  const firstYear = Math.ceil(times[0] / 5) * 5;
  const xTicks: number[] = [];
  for (let t = firstYear; t <= times[times.length - 1]; t += 5) xTicks.push(t);
  const grid = yTicks
    .map((v) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(v)}" y2="${y(v)}" stroke="#eee"/><text x="${margin.left - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#888">${formatNumber(v)}</text>`)
    .join("");
  const xAxis = xTicks.map((t) => `<text x="${x(t)}" y="${height - 6}" text-anchor="middle" font-size="10" fill="#888">${t}</text>`).join("");
  const markerLines = markers
    .filter((m) => m.time > times[0] && m.time < times[times.length - 1])
    .map(
      (m, i) =>
        `<line x1="${x(m.time)}" x2="${x(m.time)}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="#bbb" stroke-dasharray="2,3"/><text x="${x(m.time) + 3}" y="${margin.top + 9 + i * 11}" font-size="9.5" fill="#999">${m.label}</text>`,
    )
    .join("");
  const areas = bands.map((b) => area(times, b, x, y)).join("");
  const paths = lines.map((l) => path(times, l, x, y)).join("");
  const dots = points.flatMap((p) => p.times.map((t, i) => `<circle cx="${x(t).toFixed(1)}" cy="${y(p.values[i]).toFixed(1)}" r="2.6" fill="${p.color}" fill-opacity="0.85"/>`)).join("");
  return `<svg width="${width}" height="${height}">${grid}${xAxis}${markerLines}${areas}${paths}${dots}</svg>`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > 1e30) return "–";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e4) return `${trim(value / 1e3)}k`;
  if (abs >= 100) return value.toFixed(0);
  if (abs === 0) return "0";
  if (abs >= 0.01) return String(Number(value.toPrecision(3)));
  return value.toExponential(2);
}

function trim(value: number): string {
  return String(Number(value.toPrecision(3)));
}

function isMissing(v: number): boolean {
  return !Number.isFinite(v) || Math.abs(v) > 1e30;
}

function yDomain(lines: Line[], points: Points[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const l of lines) {
    for (let i = 0; i < l.values.length; i++) {
      const v = l.values[i];
      if (isMissing(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  for (const p of points) for (const v of p.values) if (!isMissing(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  if (lo === Infinity) return null;
  if (lo === hi) return [lo - Math.abs(lo || 1) * 0.1, hi + Math.abs(hi || 1) * 0.1];
  if (lo > 0 && lo < (hi - lo) * 0.6) lo = 0;
  return [lo, hi];
}

function niceDomain([lo, hi]: [number, number]): [number, number] {
  const step = niceStep((hi - lo) / 4);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

function ticks(lo: number, hi: number, count: number): number[] {
  const step = niceStep((hi - lo) / count);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function niceStep(raw: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
}

function scale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

function area(times: ArrayLike<number>, band: Band, x: (v: number) => number, y: (v: number) => number, opacity = 0.18): string {
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < times.length; i++) {
    if (isMissing(band.lower[i]) || isMissing(band.upper[i])) continue;
    top.push(`${x(times[i]).toFixed(1)},${y(band.upper[i]).toFixed(1)}`);
    bottom.unshift(`${x(times[i]).toFixed(1)},${y(band.lower[i]).toFixed(1)}`);
  }
  if (!top.length) return "";
  return `<path d="M${top.join("L")}L${bottom.join("L")}Z" fill="${band.color}" fill-opacity="${opacity}" stroke="none"/>`;
}

function path(times: ArrayLike<number>, line: Line, x: (v: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  for (let i = 0; i < line.values.length; i++) {
    const v = line.values[i];
    if (isMissing(v)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  }
  const dash = line.dash ? ` stroke-dasharray="${line.dash}"` : "";
  return `<path d="${d}" fill="none" stroke="${line.color}" stroke-width="${line.width ?? 1.5}"${dash} stroke-linejoin="round"/>`;
}
