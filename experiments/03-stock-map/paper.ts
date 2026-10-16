// A paper as published, rendered with PDF.js. The passages our findings quote are marked on the page;
// each links out to its finding, the loops it is about, and the groups and flows it charts. Figure
// panels and the model's terms in the text (heroin use disorder, remission, heroin initiation…) light up
// what they stand for on the map, and open it there when clicked.

// @ts-ignore: PDF.js is vendored as plain JavaScript.
import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";
import { FIGURES } from "./figures.ts";
import { escapeHtml } from "../shared/html.ts";
import { FAMILIES, loopTitle } from "../shared/loops.ts";
import { type MapApp, loopActive, nameOf } from "./context.ts";
import type { Finding } from "./finding-file.ts";
import type { PanelView } from "./panels.ts";

export const PAPERS: Record<string, { short: string; journal: string; title: string; doi: string }> = {
  "papers/lim-2022-pnas.pdf": { short: "Lim et al. 2022", journal: "PNAS", title: "Modeling the evolution of the US opioid crisis for national policy development", doi: "10.1073/pnas.2115714119" },
  "papers/stringfellow-2022-sciadv.pdf": {
    short: "Stringfellow et al. 2022",
    journal: "Science Advances",
    title: "Reducing opioid use disorder and overdose deaths in the United States: A dynamic modeling analysis",
    doi: "10.1126/sciadv.abm8147",
  },
};

const LIM = "papers/lim-2022-pnas.pdf";
const HEROIN_STARTS = "initiating heroin with rx misuse|initiating heroin with rx oud|initiating heroin no rx";
const MISUSE_STARTS = "initiating rx misuse own rx|initiating rx misuse diverted";
const HUD = "hud no moud|hud by moud";
const RX_OUD = "rx oud no py heroin no moud|rx oud with py heroin no moud|rx oud no heroin by moud|rx oud with heroin by moud";
const MOUD = "hud by moud|rx oud no heroin by moud|rx oud with heroin by moud";
const REMISSION = "hud in remission|rx oud with heroin in remission|rx oud no heroin in remission";
const STABLE = "hud in stable remission|rx oud with heroin in stable remission|rx oud no heroin in stable remission";

// What the panels of Lim et al.'s Figs. 2, 4 and 5 plot, by the panel ids in figures.ts;
// Fig. 3 panels plot a single flow, and Fig. 1's boxes list their stocks.
const PANEL_TARGETS: Record<string, string> = {
  inrt: `flow:${MISUSE_STARTS}`,
  inht: `flow:${HEROIN_STARTS}`,
  rout: `stock:${RX_OUD}`,
  hud: `stock:${HUD}`,
  odrb: "var:total overdose deaths rx",
  odrt: "var:total overdose deaths rx",
  odhc: "var:total overdose deaths heroin",
  main: "var:total overdose deaths",
};

// Phrases in the text and in figures drawn as text, most specific first; a match is not reused by a
// later, shorter phrase.
const TERMS: [RegExp, string][] = [
  [/heroin use disorder/gi, `stock:${HUD}`],
  [/prescription opioid use disorder/gi, `stock:${RX_OUD}`],
  [/opioid use disorder/gi, `stock:${RX_OUD}|${HUD}`],
  [/\bRx OUD\b/g, `stock:${RX_OUD}`],
  [/\bHUD\b/g, `stock:${HUD}`],
  [/\bMOUD\b/g, `stock:${MOUD}`],
  [/\bOUD\b/g, `stock:${RX_OUD}|${HUD}`],
  [/stable remission/gi, `stock:${STABLE}`],
  [/\bremission\b/gi, `stock:${REMISSION}|${STABLE}`],
  [/heroin (?:use )?initiation|initiat(?:ing|ion of) heroin(?: use)?/gi, `flow:${HEROIN_STARTS}`],
  [/(?:prescription opioid |Rx )?misuse initiation|initiat(?:ing|ion of) (?:Rx |prescription opioid )?misuse/gi, `flow:${MISUSE_STARTS}`],
  [/(?:prescription opioid|Rx) misuse/gi, "stock:rx misuse no py heroin"],
  [/nondisordered heroin use/gi, "stock:nondisordered heroin use"],
  [/overdose deaths?/gi, "var:total overdose deaths"],
];

type Link = { page: number; rect: [number, number, number, number]; label: string; hover: string; open: string };

type PageBox = { number: number; width: number; height: number; canvas: HTMLCanvasElement; overlay: HTMLElement; rendered: boolean };
type TextItem = { str: string; transform: number[]; width: number; height: number };

pdfjs.GlobalWorkerOptions.workerSrc = "../vendor/pdfjs/pdf.worker.min.mjs";

export const paperPanel: PanelView = {
  static: true,
  width: () => 660,
  kind: (_, file) => `Paper · ${PAPERS[file]?.journal ?? ""}`,
  title: (_, file) => PAPERS[file]?.title ?? file,
  render(body, app, file) {
    const findings = app.findings.filter((f) => f.paper === file);
    body.innerHTML = `<div class="passages"><h3>Passages linked into the model</h3>${findings.map((f) => passage(app, f)).join("") || '<p class="muted">None yet.</p>'}</div><div class="pages"></div>`;
    body.onclick = (e) => {
      const target = (e.target as Element).closest<HTMLElement>("[data-goto]");
      if (target) paperPanel.focus!(body, app, file, `finding:${target.dataset.goto}`);
    };
    renderPdf(app, body.querySelector<HTMLElement>(".pages")!, body, file, findings).then(() => {
      const spec = app.focus.get(`paper:${file}`);
      if (spec) paperPanel.focus!(body, app, file, spec);
    });
  },
  focus(body, _, __, spec) {
    const id = spec.replace(/^finding:/, "");
    const hits = [...body.querySelectorAll<HTMLElement>(`.hot[data-finding="${CSS.escape(id)}"]`)];
    hits[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
    for (const el of hits) {
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }
  },
  source: (_, file) => {
    const doi = PAPERS[file]?.doi;
    const article = doi ? ` · <a href="https://doi.org/${escapeHtml(doi)}" target="_blank">the article, doi:${escapeHtml(doi)}</a>` : "";
    return `<a data-open="files>papers">${escapeHtml(file)}</a> · <a href="../model/${escapeHtml(file)}" target="_blank">open the PDF</a>${article}`;
  },
};

// What a passage leads to in the model: the finding, its loops, and the groups and flows it charts.
function passage(app: MapApp, f: Finding): string {
  const loops = f.loops.flatMap((driver) => app.loops.filter((l) => l.driver === driver));
  const keys = [...new Set(f.charts.flatMap((c) => c.keys))];
  const stocks = keys.filter((k) => app.layout.nodes.some((n) => n.key === k));
  const flows = keys.filter((k) => app.layout.edges.some((e) => e.flows.some((fl) => fl.key === k)));
  const chips = [
    `<a class="chip" data-open="finding:${escapeHtml(f.id)}">Finding ${f.number}</a>`,
    ...loops.map((l) => `<a class="chip loop-chip" style="--c:${FAMILIES[l.family].color}" data-open="loop:${escapeHtml(l.id)}" data-hover="loop:${escapeHtml(l.id)}">${escapeHtml(loopTitle(l, app.plain))}</a>`),
    ...stocks.map((k) => `<a class="chip" data-open="map>stock:${escapeHtml(k)}" data-hover="stock:${escapeHtml(k)}">${escapeHtml(nameOf(app, k))}</a>`),
    ...(flows.length ? [`<a class="chip" data-open="map>flow:${escapeHtml(flows[0])}" data-hover="flow:${escapeHtml(flows.join("|"))}">${escapeHtml(flows.length > 1 ? `${flows.length} flows` : nameOf(app, flows[0]))}</a>`] : []),
  ];
  return `<div class="passage"><a class="goto" data-goto="${escapeHtml(f.id)}">p. ${f.anchors[0]?.page ?? "?"} · ${escapeHtml(f.title)}</a><div class="links">${chips.join("")}</div></div>`;
}

async function renderPdf(app: MapApp, container: HTMLElement, scroller: HTMLElement, file: string, findings: Finding[]) {
  const doc = await pdfjs.getDocument(`../model/${file}`).promise;
  const pages: PageBox[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const { width, height } = (await doc.getPage(number)).getViewport({ scale: 1 });
    pages.push(createPage(container, number, width, height));
  }
  const observer = new IntersectionObserver(
    (entries) => entries.filter((e) => e.isIntersecting).forEach((e) => renderPage(doc, pages[Number((e.target as HTMLElement).dataset.page) - 1])),
    { root: scroller, rootMargin: "800px 0px" },
  );
  for (const box of pages) observer.observe(box.canvas.parentElement!);
  for (const link of file === LIM ? figureLinks(app) : []) if (pages[link.page - 1]) linkSpot(pages[link.page - 1], link, "fig-link");
  for (const box of pages) for (const link of termLinks((await (await doc.getPage(box.number)).getTextContent()).items, box)) linkSpot(box, link, "term");
  for (const f of findings) {
    for (const anchor of f.anchors) {
      const box = pages[anchor.page - 1];
      if (!box) continue;
      const rect = findText((await (await doc.getPage(anchor.page)).getTextContent()).items, box.height, anchor.text);
      if (rect) hotspot(box, rect, f);
    }
  }
}

function createPage(container: HTMLElement, number: number, width: number, height: number): PageBox {
  const wrapper = document.createElement("div");
  wrapper.className = "page";
  wrapper.style.aspectRatio = `${width} / ${height}`;
  wrapper.dataset.page = String(number);
  const canvas = document.createElement("canvas");
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  wrapper.append(canvas, overlay);
  container.append(wrapper);
  return { number, width, height, canvas, overlay, rendered: false };
}

async function renderPage(doc: any, box: PageBox) {
  if (box.rendered) return;
  box.rendered = true;
  const page = await doc.getPage(box.number);
  const scale = (box.canvas.parentElement!.clientWidth / box.width) * Math.min(window.devicePixelRatio || 1, 2.5);
  const viewport = page.getViewport({ scale });
  box.canvas.width = Math.round(viewport.width);
  box.canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: box.canvas.getContext("2d")!, viewport }).promise;
}

// The rectangle of `needle` inside the first text item that contains it; characters are taken as
// equally wide, which is close enough for a highlight.
function findText(items: TextItem[], pageHeight: number, needle: string): [number, number, number, number] | null {
  for (const item of items) {
    const index = item.str.indexOf(needle);
    if (index < 0) continue;
    const perChar = item.width / item.str.length;
    const x = item.transform[4] + perChar * index;
    const baseline = pageHeight - item.transform[5];
    const size = item.height || Math.abs(item.transform[3]);
    return [x, baseline - size * 0.82, x + perChar * needle.length, baseline + size * 0.22];
  }
  return null;
}

function hotspot(box: PageBox, [x0, y0, x1, y1]: [number, number, number, number], f: Finding) {
  const el = document.createElement("a");
  el.className = "hot";
  el.dataset.finding = f.id;
  el.dataset.open = `finding:${f.id}`;
  el.title = `Finding ${f.number}: ${f.title}`;
  Object.assign(el.style, {
    left: `${((x0 - 2) / box.width) * 100}%`,
    top: `${((y0 - 1) / box.height) * 100}%`,
    width: `${((x1 - x0 + 4) / box.width) * 100}%`,
    height: `${((y1 - y0 + 2) / box.height) * 100}%`,
  });
  el.innerHTML = `<span class="tag">${f.number}</span>`;
  box.overlay.append(el);
}

// Lim et al.'s figure panels and diagram boxes, placed with figures.ts.
function figureLinks(app: MapApp): Link[] {
  return FIGURES.flatMap((figure) => {
    const panels = figure.panels.flatMap((panel) => {
      const target = PANEL_TARGETS[panel.id] ?? `flow:${panel.charts[0].series[0].terms[0]}`;
      return panel.rect ? [{ page: figure.page, rect: panel.rect, label: `${figure.label} · ${panel.title}`, hover: target, open: `map>${target}` }] : [];
    });
    const parts = (figure.parts ?? []).map((part) => {
      const target = targetOf(app, part.terms);
      return { page: figure.page, rect: part.rect, label: `${figure.label} · ${part.title}`, hover: target, open: `map>${target}` };
    });
    const loops = (figure.loops ?? []).flatMap((l) => {
      const loop = app.loops.find((candidate) => candidate.family === l.id && loopActive(app, candidate));
      return loop ? [{ page: figure.page, rect: l.rect, label: `${figure.label} · ${l.title}`, hover: `loop:${loop.id}`, open: `loop:${loop.id}` }] : [];
    });
    return [...panels, ...parts, ...loops];
  });
}

function targetOf(app: MapApp, keys: string[]): string {
  if (keys.every((k) => app.layout.nodes.some((n) => n.key === k))) return `stock:${keys.join("|")}`;
  return `var:${keys[0]}`;
}

// Every match of the glossary on a page, placed on the text item it falls in.
function termLinks(items: TextItem[], box: PageBox): Link[] {
  const links: Link[] = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const taken: [number, number][] = [];
    for (const [pattern, target] of TERMS) {
      for (const match of item.str.matchAll(pattern)) {
        const [from, to] = [match.index!, match.index! + match[0].length];
        if (taken.some(([a, b]) => from < b && to > a)) continue;
        taken.push([from, to]);
        const perChar = item.width / item.str.length;
        const x = item.transform[4] + perChar * from;
        const baseline = box.height - item.transform[5];
        const size = item.height || Math.abs(item.transform[3]);
        links.push({ page: box.number, rect: [x, baseline - size * 0.8, x + perChar * (to - from), baseline + size * 0.2], label: match[0], hover: target, open: `map>${target}` });
      }
    }
  }
  return links;
}

function linkSpot(box: PageBox, link: Link, className: string) {
  const el = document.createElement("a");
  el.className = className;
  el.dataset.hover = link.hover;
  el.dataset.open = link.open;
  el.title = `${link.label}: ${link.open.startsWith("loop:") ? "open the loop" : "show it on the map"}`;
  const [x0, y0, x1, y1] = link.rect;
  Object.assign(el.style, { left: `${(x0 / box.width) * 100}%`, top: `${(y0 / box.height) * 100}%`, width: `${((x1 - x0) / box.width) * 100}%`, height: `${((y1 - y0) / box.height) * 100}%` });
  if (className === "fig-link") el.innerHTML = `<span class="tag">${escapeHtml(link.label)}</span>`;
  box.overlay.append(el);
}
