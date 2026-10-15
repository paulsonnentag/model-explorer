// The files behind everything else: the folder, and any file in it with the lines in question
// highlighted. In model.mdl each definition's first line lights up what it stands for on the map;
// in a what-if file each line opens the constant it overrides.

import { parseCellName } from "../core/compile.ts";
import { escapeHtml } from "../shared/html.ts";
import type { MapApp } from "./context.ts";
import { PAPERS } from "./paper.ts";
import type { PanelView } from "./trail.ts";

const SKETCH_MARKER = "\\\\\\---///";
const HIDDEN_VIEWS = new Set(["Dashboard", "Fit to Data", "ChangeLog"]);

export const sourcePanel: PanelView = {
  static: true,
  width: () => 600,
  kind: () => "Source",
  title: (_, path) => path,
  render(body, app, path) {
    body.innerHTML = `<div class="src-info"></div><div class="code muted">Loading ${escapeHtml(path)}…</div>`;
    if (path.endsWith(".vdf")) {
      body.querySelector(".code")!.innerHTML = `A binary Vensim data file. The same data points, readable: <a data-open="source:data/historical.tsv">data/historical.tsv</a>`;
      return;
    }
    fetch(`/model/${path}`)
      .then((r) => r.text())
      .then((text) => {
        body.querySelector(".code")!.outerHTML = codeHtml(app, path, text);
        const spec = app.focus.get(`source:${path}`);
        if (spec) sourcePanel.focus!(body, app, path, spec);
      });
  },
  focus(body, app, path, spec) {
    const [kind, ...rest] = spec.split(":");
    const id = rest.join(":");
    const lines = [...body.querySelectorAll<HTMLElement>(".ln")];
    if (!lines.length) return;
    const start = kind === "line" ? Number(id) : kind === "var" ? lineOf(app, path, id, lines) : 0;
    if (!start) return;
    const end = blockEnd(lines, start);
    lines.forEach((el, i) => el.classList.toggle("hit", i + 1 >= start && i + 1 <= end));
    lines[start - 1].scrollIntoView({ block: "center" });
    body.querySelector(".src-info")!.innerHTML = kind === "var" ? infoHtml(app, path, id, start) : "";
  },
  source: (_, path) => `<a href="/model/${escapeHtml(path)}" target="_blank">open the raw file</a>`,
};

export const filesPanel: PanelView = {
  static: true,
  width: () => 360,
  kind: () => "Files",
  title: () => "opioid-model/",
  render(body, app) {
    const b = app.bundle;
    const file = (path: string, note = "") => `<a class="file" data-open="${path.endsWith(".pdf") ? "paper" : "source"}:${escapeHtml(path)}"><span>${escapeHtml(path.split("/").pop()!)}</span><small>${escapeHtml(note)}</small></a>`;
    const folder = (name: string, note: string, files: string) => `<div class="folder" data-folder="${escapeHtml(name)}"><b>${escapeHtml(name)}/</b><small>${escapeHtml(note)}</small>${files}</div>`;
    const whatIfs = ["futures", "history", "policies", "tests"].map((group) => {
      const files = b.scenarios.filter((s) => s.file.startsWith(`what-ifs/${group}/`));
      return folder(group, `${files.length} files`, files.map((s) => file(s.file, `${s.overrides.length} lines`)).join(""));
    });
    body.innerHTML = `<p class="hint">Copied from the authors' repository and sorted by what each file is for. Every panel links back to the file and line it is drawn from.</p>
      ${file("README.md")}
      ${file("model.mdl", `${b.mdl.definitions.length} definitions, ${b.mdl.views.length} diagrams`)}
      ${folder("every-run", "applied before any what-if", [b.files.calibrationWeights, b.files.projectionEndValues, b.files.fittedValues].map((f) => file(f)).join(""))}
      ${folder("what-ifs", "one file per alternative run", whatIfs.join(""))}
      ${folder("data", "what the model is compared against", [...b.files.dataFiles].map((f) => file(f)).join(""))}
      ${folder("findings", "claims from the papers, ours", app.findings.map((f) => file(f.file, `Finding ${f.number}`)).join(""))}
      ${folder("papers", "the two papers", b.papers.map((f) => file(f, PAPERS[f]?.short ?? "")).join(""))}`;
  },
  focus(body, _, __, spec) {
    const el = body.querySelector<HTMLElement>(`[data-folder="${CSS.escape(spec)}"]`);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
    el?.classList.remove("flash");
    void el?.offsetWidth;
    el?.classList.add("flash");
  },
};

// model.mdl stops before the diagrams, which are the same model drawn; each definition's first line is
// marked with its variable. What-if lines are marked with the constant they set.
function codeHtml(app: MapApp, path: string, text: string): string {
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  const starts = new Map<number, string>();
  let note = "";
  if (path === app.bundle.files.model) {
    const sketch = lines.findIndex((l) => l.startsWith(SKETCH_MARKER));
    if (sketch > 0) {
      note = `<div class="ln note">The rest of the file (${lines.length - sketch} lines) draws the authors' ${app.bundle.mdl.views.length} diagrams.</div>`;
      lines = lines.slice(0, sketch);
    }
    for (const d of app.bundle.mdl.definitions) if (!starts.has(d.line)) starts.set(d.line, d.key);
  }
  const isWhatIf = path.endsWith(".cin");
  const rows = lines.map((line, i) => {
    const key = starts.get(i + 1) ?? (isWhatIf && line.includes("=") ? parseCellName(line.split("=")[0]).variable : null);
    const attrs = key ? ` data-hover="var:${escapeHtml(key)}" data-var="${escapeHtml(key)}"${isWhatIf ? ` data-open="source:model.mdl>var:${escapeHtml(key)}"` : ""}` : "";
    return `<div class="ln${key ? " def" : ""}"${attrs}><i>${i + 1}</i><code>${escapeHtml(line) || " "}</code></div>`;
  });
  return `<div class="code">${rows.join("")}${note}</div>`;
}

function lineOf(app: MapApp, path: string, key: string, lines: HTMLElement[]): number {
  if (path === app.bundle.files.model) return app.lines.get(key) ?? 0;
  return lines.findIndex((el) => el.dataset.var === key || el.querySelector("code")!.textContent!.startsWith(`${key}\t`)) + 1;
}

// A definition runs until the line ending in the "|" that closes it.
function blockEnd(lines: HTMLElement[], start: number): number {
  for (let i = start - 1; i < Math.min(lines.length, start + 60); i++) if (/\|\s*$/.test(lines[i].querySelector("code")!.textContent!)) return i + 1;
  return start;
}

function infoHtml(app: MapApp, path: string, key: string, line: number): string {
  if (path !== app.bundle.files.model) return "";
  const definition = app.bundle.mdl.definitions.find((d) => d.key === key);
  const views = app.bundle.mdl.views.filter((v) => !HIDDEN_VIEWS.has(v.name) && v.variableKeys.includes(key)).map((v) => v.name);
  return `<b>${escapeHtml(definition?.name ?? key)}</b> · line ${line}${definition?.group ? ` · section ${escapeHtml(definition.group)}` : ""}${views.length ? ` · drawn on ${views.map((v) => `“${escapeHtml(v)}”`).join(", ")}` : ""}`;
}
