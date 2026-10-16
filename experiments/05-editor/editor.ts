// The editor: opioid-model/ opened like a project in a code editor. Files open as tabs on the left,
// the model's views (the map, loops, findings, what-ifs) as tabs on the right, so the running model sits
// next to the code it runs from. Pointing at a definition lights it up on the map; clicking one shows
// it there.

import type { Layout } from "../03-stock-map/app.ts";
import type { MapApp } from "../03-stock-map/context.ts";
import { PAPERS } from "../03-stock-map/paper.ts";
import { VIEWS, createPanel, focusInPanel, menuEntries, parseKey } from "../03-stock-map/panels.ts";
import { escapeHtml } from "../shared/html.ts";
import { FAMILIES } from "../shared/loops.ts";

type Group = "code" | "model";
type Node = { name: string; path: string; children: Node[] };

const CODE_KINDS = new Set(["source", "paper", "files"]);
const FOLDED = new Set(["data", "what-ifs/history", "what-ifs/policies", "what-ifs/tests"]);
const SPLIT_KEY = "editor-split";

export function editorLayout(root: HTMLElement): Layout {
  const active: Record<Group, string> = { code: "", model: "" };
  let app: MapApp | null = null;
  const explorer = root.querySelector<HTMLElement>("#explorer")!;
  const groups = root.querySelector<HTMLElement>("#groups")!;

  const render = (current: MapApp) => {
    if (!app) {
      app = current;
      explorer.innerHTML = explorerHtml(current);
    }
    for (const group of ["code", "model"] as const) renderGroup(root, current, group, active);
    markExplorer(explorer, current, active.code);
  };

  explorer.addEventListener("click", (e) => {
    const file = (e.target as Element).closest<HTMLElement>("[data-files]");
    if (!file || !app) return;
    e.preventDefault();
    for (const spec of file.dataset.files!.split(",")) app.actions.open(spec);
    const runs = file.dataset.path === app.bundle.files.model || file.dataset.path!.endsWith(".cin");
    if (runs && !app.panels.some((k) => groupOf(k) === "model")) app.actions.open("map");
  });
  groups.addEventListener("click", (e) => {
    const target = e.target as Element;
    const tab = target.closest<HTMLElement>(".tab[data-tab]");
    if (tab && !target.closest("[data-close]") && app) {
      active[groupOf(tab.dataset.tab!)] = tab.dataset.tab!;
      return render(app);
    }
    if (target.closest("[data-open], a, button") || !app) return;
    const line = target.closest<HTMLElement>(".panel-source .ln.def[data-var]");
    if (!line) return;
    line.parentElement!.querySelectorAll(".ln.cursor").forEach((el) => el.classList.remove("cursor"));
    line.classList.add("cursor");
    app.actions.open(`map>var:${line.dataset.var}`);
  });
  groups.addEventListener("auxclick", (e) => {
    const tab = (e.target as Element).closest<HTMLElement>(".tab[data-tab]");
    if (tab && e.button === 1 && app) app.actions.close(tab.dataset.tab!);
  });
  enableSplitter(groups);
  root.querySelector<HTMLElement>("[data-toggle-sidebar]")!.onclick = (e) => {
    (e.currentTarget as HTMLElement).classList.toggle("on");
    document.body.classList.toggle("no-sidebar");
  };

  return {
    root,
    place(current, key) {
      if (!current.panels.includes(key)) current.panels = [...current.panels, key];
      active[groupOf(key)] = key;
    },
    render,
    reveal(current, key, spec) {
      if (active[groupOf(key)] !== key) {
        active[groupOf(key)] = key;
        render(current);
      }
      focusInPanel(root, current, key, spec);
    },
  };
}

function groupOf(key: string): Group {
  return CODE_KINDS.has(parseKey(key).kind) ? "code" : "model";
}

// Brings one editor group in line with the open panels: a tab per panel, the active one shown, and a
// watermark when there is none.
function renderGroup(root: HTMLElement, app: MapApp, group: Group, active: Record<Group, string>) {
  const el = root.querySelector<HTMLElement>(`.group[data-group="${group}"]`)!;
  const panes = el.querySelector<HTMLElement>(".panes")!;
  const keys = app.panels.filter((k) => groupOf(k) === group);
  for (const panel of panes.querySelectorAll<HTMLElement>(":scope > section.panel")) if (!keys.includes(panel.dataset.panel!)) panel.remove();
  for (const key of keys) if (!panes.querySelector(`:scope > section.panel[data-panel="${CSS.escape(key)}"]`)) panes.append(createPanel(app, key));
  if (!keys.includes(active[group])) active[group] = keys.at(-1) ?? "";
  for (const panel of panes.querySelectorAll<HTMLElement>(":scope > section.panel")) panel.classList.toggle("active", panel.dataset.panel === active[group]);
  el.querySelector(".tabs")!.innerHTML = keys.map((k) => tabHtml(app, k, k === active[group])).join("");
  el.querySelector(".crumbs")!.innerHTML = active[group] ? crumbsHtml(app, active[group]) : "";
  el.classList.toggle("empty", !keys.length);
  el.querySelector(".watermark")!.innerHTML = keys.length ? "" : watermarkHtml(group);
}

function tabHtml(app: MapApp, key: string, active: boolean): string {
  const { kind, id } = parseKey(key);
  const view = VIEWS[kind];
  return `<div class="tab${active ? " active" : ""}" data-tab="${escapeHtml(key)}" title="${escapeHtml(`${view.kind(app, id)} · ${view.title(app, id)}`)}">
    ${iconHtml(app, key)}<span class="label">${escapeHtml(tabLabel(app, key))}</span><button data-close="${escapeHtml(key)}" title="Close">×</button></div>`;
}

function tabLabel(app: MapApp, key: string): string {
  const { kind, id } = parseKey(key);
  const view = VIEWS[kind];
  if (kind === "source") {
    const [path, asOf] = id.split("@");
    return asOf ? `${basename(path)} ↔ ${basename(asOf)}` : basename(path);
  }
  if (kind === "paper") return PAPERS[id]?.short ?? basename(id);
  if (kind === "loop") return view.title(app, id);
  return view.kind(app, id);
}

// Where the active tab sits: its folder path for a file, the model's view for the rest.
function crumbsHtml(app: MapApp, key: string): string {
  const { kind, id } = parseKey(key);
  const parts = kind === "source" || kind === "paper" ? ["opioid-model", ...id.split("@")[0].split("/")] : kind === "files" ? ["opioid-model"] : ["model", VIEWS[kind].kind(app, id), ...(id ? [tabLabel(app, key)] : [])];
  return parts.map((p) => `<span>${escapeHtml(p)}</span>`).join(`<i>›</i>`);
}

function watermarkHtml(group: Group): string {
  const entries =
    group === "code"
      ? [
          ["source:model.mdl", "Open model.mdl", "the equations"],
          ["paper:papers/lim-2022-pnas.pdf", "Open the paper", "Lim et al. 2022"],
        ]
      : [
          ["map", "Show the model", "the stock and flow map"],
          ["findings", "Show the findings", "claims from the papers"],
        ];
  return `<div class="mark">SOURCE</div>${entries.map(([spec, label, hint]) => `<a data-open="${spec}"><b>${label}</b><small>${hint}</small></a>`).join("")}`;
}

function iconHtml(app: MapApp, key: string): string {
  const { kind, id } = parseKey(key);
  if (kind === "source" || kind === "paper") return fileIcon(id.split("@")[0]);
  if (kind === "loop") {
    const loop = app.loops.find((l) => l.id === id);
    return `<i class="icon dot" style="--c:${loop ? FAMILIES[loop.family].color : "#999"}"></i>`;
  }
  const glyphs: Record<string, [string, string]> = { map: ["◫", "#2f6db5"], finding: ["★", "#d97706"], findings: ["≡", "#d97706"], loops: ["↻", "#7c3aed"], whatifs: ["▶", "#16a34a"], files: ["▤", "#6a6f76"] };
  const [glyph, color] = glyphs[kind] ?? ["•", "#6a6f76"];
  return `<i class="icon" style="color:${color}">${glyph}</i>`;
}

function fileIcon(path: string): string {
  const ext = path.split(".").pop()!;
  const icons: Record<string, [string, string]> = { mdl: ["V", "#a855f7"], cin: ["{}", "#d97706"], out: ["{}", "#b45309"], md: ["M↓", "#2f6db5"], pdf: ["PDF", "#dc2626"], tsv: ["≡", "#16a34a"], vdf: ["01", "#6a6f76"] };
  const [glyph, color] = icons[ext] ?? ["•", "#6a6f76"];
  return `<i class="icon file-icon" style="color:${color}">${glyph}</i>`;
}

// The project tree: every file the model runs from, folders first, with the model's views below it.
function explorerHtml(app: MapApp): string {
  const b = app.bundle;
  const paths = [
    "README.md",
    b.files.model,
    b.files.calibrationWeights,
    b.files.projectionEndValues,
    b.files.fittedValues,
    ...b.scenarios.map((s) => s.file),
    ...b.files.dataFiles,
    ...app.findings.map((f) => f.file),
    ...b.papers,
  ];
  const views = menuEntries(app)
    .filter((e) => e.section === "The model")
    .map((e) => `<a class="item" data-open="${escapeHtml(e.spec)}" style="--depth:0">${iconHtml(app, e.spec)}<span>${escapeHtml(e.label)}</span><small>${escapeHtml(e.hint)}</small></a>`)
    .join("");
  return `<details open class="section"><summary>opioid-model</summary>${tree(paths).children.map((n) => nodeHtml(app, n, 0)).join("")}</details>
    <details open class="section"><summary>Model</summary>${views}</details>`;
}

function tree(paths: string[]): Node {
  const top: Node = { name: "", path: "", children: [] };
  for (const path of paths) {
    let node = top;
    path.split("/").forEach((name, i, parts) => {
      const at = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === name);
      if (!child) node.children.push((child = { name, path: at, children: [] }));
      node = child;
    });
  }
  const sort = (node: Node) => {
    node.children.sort((a, b) => Number(!a.children.length) - Number(!b.children.length) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    node.children.forEach(sort);
  };
  sort(top);
  return top;
}

function nodeHtml(app: MapApp, node: Node, depth: number): string {
  if (node.children.length) {
    return `<details${FOLDED.has(node.path) ? "" : " open"}><summary class="item" style="--depth:${depth}"><span>${escapeHtml(node.name)}</span></summary>${node.children.map((c) => nodeHtml(app, c, depth + 1)).join("")}</details>`;
  }
  const finding = app.findings.find((f) => f.file === node.path);
  const specs = node.path.endsWith(".pdf") ? [`paper:${node.path}`] : [`source:${node.path}`, ...(finding ? [`finding:${finding.id}`] : [])];
  return `<a class="item leaf" data-files="${escapeHtml(specs.join(","))}" data-path="${escapeHtml(node.path)}" style="--depth:${depth}">${fileIcon(node.path)}<span>${escapeHtml(node.name)}</span></a>`;
}

// The file in the active tab is selected in the tree, and every open file is marked.
function markExplorer(explorer: HTMLElement, app: MapApp, activeKey: string) {
  const pathOf = (key: string) => (CODE_KINDS.has(parseKey(key).kind) ? parseKey(key).id.split("@")[0] : "");
  const open = new Set(app.panels.map(pathOf));
  for (const el of explorer.querySelectorAll<HTMLElement>("[data-path]")) {
    el.classList.toggle("active", el.dataset.path === pathOf(activeKey));
    el.classList.toggle("open", open.has(el.dataset.path!));
  }
  for (const el of explorer.querySelectorAll<HTMLElement>("[data-open]")) el.classList.toggle("open", app.panels.includes(el.dataset.open!));
}

// The line between the two groups drags to share the width between them.
function enableSplitter(groups: HTMLElement) {
  const sash = groups.querySelector<HTMLElement>(".sash")!;
  const apply = (share: number) => groups.style.setProperty("--split", `${Math.round(share * 1000) / 10}%`);
  apply(Number(localStorage.getItem(SPLIT_KEY)) || 0.46);
  sash.onpointerdown = (down) => {
    down.preventDefault();
    sash.setPointerCapture(down.pointerId);
    document.body.classList.add("resizing");
    const box = groups.getBoundingClientRect();
    sash.onpointermove = (move) => apply(Math.min(0.8, Math.max(0.2, (move.clientX - box.left) / box.width)));
    sash.onpointerup = () => {
      sash.onpointermove = sash.onpointerup = null;
      document.body.classList.remove("resizing");
      localStorage.setItem(SPLIT_KEY, String(parseFloat(groups.style.getPropertyValue("--split")) / 100));
    };
  };
}

function basename(path: string): string {
  return path.split("/").pop()!;
}
