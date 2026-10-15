// A paper as published, rendered with PDF.js. The passages our findings quote are marked on the page;
// each links out to its finding, the loops it is about, and the groups and flows it charts.

// @ts-ignore: PDF.js is vendored as plain JavaScript.
import * as pdfjs from "/vendor/pdfjs/pdf.min.mjs";
import { escapeHtml } from "../shared/html.ts";
import { FAMILIES, loopTitle } from "../shared/loops.ts";
import { type MapApp, nameOf } from "./context.ts";
import type { Finding } from "./finding-file.ts";
import type { PanelView } from "./trail.ts";

export const PAPERS: Record<string, { short: string; journal: string; title: string }> = {
  "papers/lim-2022-pnas.pdf": { short: "Lim et al. 2022", journal: "PNAS", title: "Modeling the evolution of the US opioid crisis for national policy development" },
  "papers/stringfellow-2022-sciadv.pdf": {
    short: "Stringfellow et al. 2022",
    journal: "Science Advances",
    title: "Reducing opioid use disorder and overdose deaths in the United States: A dynamic modeling analysis",
  },
};

type PageBox = { number: number; width: number; height: number; canvas: HTMLCanvasElement; overlay: HTMLElement; rendered: boolean };
type TextItem = { str: string; transform: number[]; width: number; height: number };

pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";

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
    renderPdf(body.querySelector<HTMLElement>(".pages")!, body, file, findings).then(() => {
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
  source: (_, file) => `<a data-open="files>papers">${escapeHtml(file)}</a> · <a href="/model/${escapeHtml(file)}" target="_blank">open the PDF</a>`,
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

async function renderPdf(container: HTMLElement, scroller: HTMLElement, file: string, findings: Finding[]) {
  const doc = await pdfjs.getDocument(`/model/${file}`).promise;
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
