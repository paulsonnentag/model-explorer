// Renders the paper with PDF.js and lays clickable regions over its figures, Table 1 rows and claims.
// Figures are vector drawings, so their regions come from the manifest; claims and table rows are
// found by searching the page text, so they stay attached to the words they mark.

// @ts-ignore: PDF.js is vendored as plain JavaScript.
import * as pdfjs from "/vendor/pdfjs/pdf.min.mjs";
import { escapeHtml } from "../shared/html.ts";
import type { Selection, Status } from "./context.ts";
import { STATUS_TEXT } from "./context.ts";
import type { Item, Rect } from "./items.ts";
import { CLAIMS, FIGURES, TABLE_ROWS } from "./items.ts";

export type PaperView = {
  setStatus: (id: string, status: Status) => void;
  highlight: (selection: Selection | null) => void;
  scrollTo: (item: Item) => void;
};

type PageBox = { number: number; width: number; height: number; overlay: HTMLElement; canvas: HTMLCanvasElement; rendered: boolean };
type TextItem = { str: string; transform: number[]; width: number; height: number };

const PDF_URL = "/files/lim-2022-source.pdf";
const TABLE_COLUMNS: [number, number] = [34, 552];

pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";

export async function renderPaper(container: HTMLElement, onSelect: (selection: Selection) => void): Promise<PaperView> {
  const doc = await pdfjs.getDocument(PDF_URL).promise;
  const pages: PageBox[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const { width, height } = page.getViewport({ scale: 1 });
    pages.push(createPage(container, number, width, height));
  }
  renderVisiblePages(doc, pages, container);
  const hotspots = new Map<string, HTMLElement[]>();
  const add = (id: string, el: HTMLElement) => hotspots.set(id, [...(hotspots.get(id) ?? []), el]);
  for (const figure of FIGURES) addFigure(pages[figure.page - 1], figure, add, onSelect);
  await addTextAnchors(doc, pages, add, onSelect);
  return {
    setStatus: (id, status) => {
      for (const el of hotspots.get(id) ?? []) {
        el.classList.remove("reproduced", "close", "differs");
        el.classList.add(status);
        el.dataset.mark = STATUS_TEXT[status].mark;
      }
    },
    highlight: (selection) => {
      container.querySelectorAll(".hot.selected").forEach((el) => el.classList.remove("selected"));
      if (!selection) return;
      for (const el of hotspots.get(selection.item.id) ?? []) el.classList.add("selected");
      if (selection.sub) container.querySelector(`[data-item="${selection.item.id}"][data-sub="${selection.sub}"]`)?.classList.add("selected");
    },
    scrollTo: (item) => {
      const el = hotspots.get(item.id)?.[0];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
  };
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
  return { number, width, height, overlay, canvas, rendered: false };
}

function renderVisiblePages(doc: any, pages: PageBox[], container: HTMLElement) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const box = pages[Number((entry.target as HTMLElement).dataset.page) - 1];
        if (!box.rendered) renderPage(doc, box);
      }
    },
    { root: container, rootMargin: "800px 0px" },
  );
  for (const box of pages) observer.observe(box.canvas.parentElement!);
}

async function renderPage(doc: any, box: PageBox) {
  box.rendered = true;
  const page = await doc.getPage(box.number);
  const cssWidth = box.canvas.parentElement!.clientWidth;
  const scale = (cssWidth / box.width) * Math.min(window.devicePixelRatio || 1, 2.5);
  const viewport = page.getViewport({ scale });
  box.canvas.width = Math.round(viewport.width);
  box.canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: box.canvas.getContext("2d")!, viewport }).promise;
}

function addFigure(box: PageBox, figure: (typeof FIGURES)[number], add: (id: string, el: HTMLElement) => void, onSelect: (s: Selection) => void) {
  const region = hotspot(box, figure.rect, "hot figure", figure.id);
  region.innerHTML = `<span class="tag">${escapeHtml(figure.label)} · open</span>`;
  region.addEventListener("click", () => onSelect({ item: figure }));
  add(figure.id, region);
  const subs = [
    ...figure.panels.filter((p) => p.rect).map((p) => ({ id: p.id, rect: p.rect!, title: p.title })),
    ...(figure.parts ?? []).map((p) => ({ id: p.id, rect: p.rect, title: p.title })),
    ...(figure.loops ?? []).map((l) => ({ id: l.id, rect: l.rect, title: `${l.title} loop` })),
  ];
  for (const sub of subs) {
    const el = hotspot(box, sub.rect, "hot sub", figure.id, sub.id);
    el.title = sub.title;
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelect({ item: figure, sub: sub.id });
    });
  }
}

async function addTextAnchors(doc: any, pages: PageBox[], add: (id: string, el: HTMLElement) => void, onSelect: (s: Selection) => void) {
  const textByPage = new Map<number, TextItem[]>();
  const textOf = async (number: number) => {
    if (!textByPage.has(number)) textByPage.set(number, (await (await doc.getPage(number)).getTextContent()).items);
    return textByPage.get(number)!;
  };
  for (const row of TABLE_ROWS) {
    const box = pages[row.page - 1];
    const rect = findText(await textOf(row.page), box.height, row.anchor);
    if (!rect) continue;
    const el = hotspot(box, [TABLE_COLUMNS[0], rect[1] - 1.5, TABLE_COLUMNS[1], rect[3] + 1], "hot row", row.id);
    el.title = `${row.label}: open`;
    el.addEventListener("click", () => onSelect({ item: row }));
    add(row.id, el);
  }
  for (const claim of CLAIMS) {
    const box = pages[claim.page - 1];
    for (const anchor of claim.anchors) {
      const rect = findText(await textOf(claim.page), box.height, anchor);
      if (!rect) continue;
      const el = hotspot(box, [rect[0] - 1.5, rect[1] - 1, rect[2] + 1.5, rect[3] + 1], "hot claim", claim.id);
      el.title = `${claim.label}: check this number`;
      el.addEventListener("click", () => onSelect({ item: claim }));
      add(claim.id, el);
    }
  }
}

// The rectangle of `needle` inside the first text item that contains it; character widths are
// approximated as equal, which is close enough for a highlight.
function findText(items: TextItem[], pageHeight: number, needle: string): Rect | null {
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

function hotspot(box: PageBox, [x0, y0, x1, y1]: Rect, className: string, item: string, sub?: string): HTMLElement {
  const el = document.createElement("button");
  el.className = className;
  el.dataset.item = item;
  if (sub) el.dataset.sub = sub;
  Object.assign(el.style, {
    left: `${(x0 / box.width) * 100}%`,
    top: `${(y0 / box.height) * 100}%`,
    width: `${((x1 - x0) / box.width) * 100}%`,
    height: `${((y1 - y0) / box.height) * 100}%`,
  });
  box.overlay.append(el);
  return el;
}
