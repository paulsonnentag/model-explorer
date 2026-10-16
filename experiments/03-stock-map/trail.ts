// The trail: open panels side by side, left to right, with the menu after the last one. A link opens
// its panel right after the one it is in.

import type { Layout } from "./app.ts";
import type { MapApp } from "./context.ts";
import { VIEWS, createPanel, focusInPanel, menuHtml, parseKey } from "./panels.ts";

const MIN_PANEL_WIDTH = 240;

export function trailLayout(root: HTMLElement): Layout {
  return {
    root,
    place(app, key, from) {
      const panels = app.panels.filter((k) => k !== key);
      panels.splice(from && panels.includes(from) ? panels.indexOf(from) + 1 : panels.length, 0, key);
      app.panels = panels;
    },
    render: (app) => renderTrail(root, app),
    reveal(app, key, spec) {
      root.querySelector(`:scope > section.panel[data-panel="${CSS.escape(key)}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
      focusInPanel(root, app, key, spec);
    },
    start: () => root.scrollTo({ left: 0 }),
  };
}

function renderTrail(root: HTMLElement, app: MapApp) {
  const existing = new Map([...root.querySelectorAll<HTMLElement>(":scope > section.panel")].map((el) => [el.dataset.panel!, el]));
  for (const [key, el] of existing) if (!app.panels.includes(key)) el.remove();
  let previous: Element | null = null;
  for (const key of app.panels) {
    const el = existing.get(key) ?? trailPanel(app, key);
    if (el.previousElementSibling !== previous || !el.isConnected) {
      const body = el.querySelector<HTMLElement>(".body")!;
      const scroll = [body.scrollTop, body.scrollLeft];
      root.insertBefore(el, previous ? previous.nextSibling : root.firstChild);
      [body.scrollTop, body.scrollLeft] = scroll;
    }
    previous = el;
  }
  const menu = root.querySelector<HTMLElement>(":scope > nav.menu") ?? root.appendChild(document.createElement("nav"));
  menu.className = "menu";
  menu.innerHTML = menuHtml(app);
  root.appendChild(menu);
}

function trailPanel(app: MapApp, key: string): HTMLElement {
  const { kind } = parseKey(key);
  const el = createPanel(app, key);
  el.style.width = `${savedWidth(kind) ?? VIEWS[kind].width(app)}px`;
  const handle = el.appendChild(document.createElement("div"));
  handle.className = "resize";
  handle.title = "Drag to resize, double-click to reset";
  handle.onpointerdown = (e) => startResize(el, kind, e);
  handle.ondblclick = () => {
    localStorage.removeItem(widthKey(kind));
    el.style.width = `${VIEWS[kind].width(app)}px`;
  };
  return el;
}

// Dragging the right edge sets the panel's width, remembered for every panel of its kind.
function startResize(el: HTMLElement, kind: string, down: PointerEvent) {
  down.preventDefault();
  const handle = down.currentTarget as HTMLElement;
  handle.setPointerCapture(down.pointerId);
  const startWidth = el.getBoundingClientRect().width;
  document.body.classList.add("resizing");
  handle.onpointermove = (move) => {
    el.style.width = `${Math.max(MIN_PANEL_WIDTH, Math.round(startWidth + move.clientX - down.clientX))}px`;
  };
  handle.onpointerup = handle.onpointercancel = () => {
    handle.onpointermove = handle.onpointerup = handle.onpointercancel = null;
    document.body.classList.remove("resizing");
    localStorage.setItem(widthKey(kind), String(parseInt(el.style.width)));
  };
}

function savedWidth(kind: string): number | null {
  const width = Number(localStorage.getItem(widthKey(kind)));
  return width >= MIN_PANEL_WIDTH ? width : null;
}

function widthKey(kind: string): string {
  return `panel-width:${kind}`;
}
