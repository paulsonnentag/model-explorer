// The files behind everything else: the folder, and any file in it with the lines in question
// highlighted. In model.mdl each definition's first line lights up what it stands for on the map;
// in a what-if file each line opens the constant it overrides. "model.mdl@<what-if file>" is the model
// as that run sees it: the constants the file replaces are struck out and marked with their new values.

import { parseCellName } from "../core/compile.ts";
import type { Override } from "../core/compile.ts";
import { escapeHtml } from "../shared/html.ts";
import { LEVERS, type WhatIf } from "../shared/runs.ts";
import { type MapApp, updateLive } from "./context.ts";
import { PAPERS } from "./paper.ts";
import type { PanelView } from "./panels.ts";

const SKETCH_MARKER = "\\\\\\---///";
const HIDDEN_VIEWS = new Set(["Dashboard", "Fit to Data", "ChangeLog"]);
const SHOWN_VALUES = 4;

type Setting = { file: string; target: string; value: number; whatIf: boolean };

export const sourcePanel: PanelView = {
  static: true,
  width: () => 720,
  kind: (_, id) => (id.includes("@") ? "Source · as of a what-if" : "Source"),
  title: (_, id) => (id.includes("@") ? `model.mdl as of ${id.split("/").pop()}` : id),
  render(body, app, id) {
    const [path, asOf] = id.split("@");
    body.innerHTML = `<div class="src-head">${barHtml(app, path, asOf)}<div class="src-info"></div></div><div class="code muted">Loading ${escapeHtml(path)}…</div>`;
    body.onclick = (e) => {
      const run = (e.target as Element).closest<HTMLElement>("[data-run-file]");
      const patch = run && runOf(app, run.dataset.runFile!);
      if (patch) app.actions.setWhatIf(patch);
    };
    if (path.endsWith(".vdf")) {
      body.querySelector(".code")!.innerHTML = `A binary Vensim data file. The same data points, readable: <a data-open="source:data/historical.tsv">data/historical.tsv</a>`;
      return;
    }
    fetch(`../model/${path}`)
      .then((r) => r.text())
      .then((text) => {
        body.querySelector(".code")!.outerHTML = codeHtml(app, path, text, asOf ? settingsAsOf(app, asOf) : new Map());
        markReplaced(body);
        updateLive(body, app);
        const spec = app.focus.get(`source:${id}`);
        if (spec) sourcePanel.focus!(body, app, id, spec);
      });
  },
  focus(body, app, id, spec) {
    const path = id.split("@")[0];
    const [kind, ...rest] = spec.split(":");
    const target = rest.join(":");
    const lines = [...body.querySelectorAll<HTMLElement>(".ln")];
    if (!lines.length) return;
    const start = kind === "line" ? Number(target) : kind === "var" ? lineOf(app, path, target, lines) : 0;
    if (!start) return;
    const end = blockEnd(lines, start);
    lines.forEach((el, i) => el.classList.toggle("hit", i + 1 >= start && i + 1 <= end));
    lines[start - 1].scrollIntoView({ block: "center" });
    body.querySelector(".src-info")!.innerHTML = kind === "var" ? infoHtml(app, path, target, start) : "";
  },
  source: (_, id) => `<a href="../model/${escapeHtml(id.split("@")[0])}" target="_blank">open the raw file</a>`,
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

// Above a what-if file, a way to see the model as of it; above the model as of a file, what that file
// changes.
function barHtml(app: MapApp, path: string, asOf: string | undefined): string {
  const scenario = app.bundle.scenarios.find((s) => s.file === (asOf ?? path));
  if (!scenario) return "";
  const run = runOf(app, scenario.file) ? `<button data-run-file="${escapeHtml(scenario.file)}">Run the trail in this what-if</button>` : "";
  if (!asOf) return `<div class="as-of">A what-if. <a data-open="source:model.mdl@${escapeHtml(path)}">View model.mdl as of this file</a>${run}</div>`;
  const keys = [...new Set(scenario.overrides.map((o) => parseCellName(o.target).variable))];
  const name = (key: string) => app.bundle.mdl.definitions.find((d) => d.key === key)?.name ?? key;
  const everyRun = app.bundle.baseChanges.reduce((n, c) => n + c.overrides.length, app.bundle.fitted.length);
  return `<div class="as-of">The equations as written, then every-run/ (${everyRun} values, faint), then <a data-open="source:${escapeHtml(asOf)}">${escapeHtml(asOf.split("/").pop()!)}</a>, which replaces:
    <span class="set-list">${keys.map((k) => `<a data-open="source:model.mdl@${escapeHtml(asOf)}>var:${escapeHtml(k)}" data-hover="var:${escapeHtml(k)}" data-var="${escapeHtml(k)}">${escapeHtml(name(k))}</a>`).join("")}</span>
    ${run}<a data-open="source:model.mdl">model.mdl as written</a></div>`;
}

// What the model's constants are set to by the time the what-if runs, latest file last.
function settingsAsOf(app: MapApp, file: string): Map<string, Setting[]> {
  const b = app.bundle;
  const layers: { file: string; overrides: Override[]; whatIf: boolean }[] = [
    ...b.baseChanges.map((c) => ({ ...c, whatIf: false })),
    { file: b.files.fittedValues, overrides: b.fitted, whatIf: false },
    { file, overrides: b.scenarios.find((s) => s.file === file)?.overrides ?? [], whatIf: true },
  ];
  const settings = new Map<string, Setting[]>();
  for (const layer of layers) {
    for (const o of layer.overrides) {
      if (typeof o.value !== "number") continue;
      const key = parseCellName(o.target).variable;
      const kept = (settings.get(key) ?? []).filter((s) => s.target !== o.target && !(layer.whatIf && !s.whatIf));
      settings.set(key, [...kept, { file: layer.file, target: o.target, value: o.value, whatIf: layer.whatIf }]);
    }
  }
  return settings;
}

// The run a what-if file stands for, in the trail's terms; tests and odd strengths have none.
function runOf(app: MapApp, file: string): Partial<WhatIf> | null {
  const scenario = app.bundle.scenarios.find((s) => s.file === file);
  if (scenario?.kind === "future") return { future: scenario.name };
  if (scenario?.kind === "counterfactual") return { noFentanyl: true };
  if (scenario?.kind !== "lever") return null;
  const [, lever, strength = "20"] = scenario.name.match(/^(.*?)(10|50)?$/)!;
  const patch = { lever, strength: strength as WhatIf["strength"] };
  return LEVERS.some((l) => l.name === lever) && app.runs.leverFile({ ...app.whatIf, ...patch }) === scenario.name ? patch : null;
}

// model.mdl stops before the diagrams, which are the same model drawn; each definition's first line is
// marked with its variable, and with what it is set to as of a what-if. What-if lines are marked with the
// constant they set.
function codeHtml(app: MapApp, path: string, text: string, settings: Map<string, Setting[]>): string {
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
  const parts = path === app.bundle.files.model ? definitionParts(lines) : [];
  const rows = lines.map((line, i) => {
    const key = starts.get(i + 1) ?? (isWhatIf && line.includes("=") ? parseCellName(line.split("=")[0]).variable : null);
    const attrs = key ? ` data-hover="var:${escapeHtml(key)}" data-var="${escapeHtml(key)}"${isWhatIf ? ` data-open="source:model.mdl>var:${escapeHtml(key)}"` : ""}` : "";
    const set = key && starts.has(i + 1) ? settings.get(key) : undefined;
    const part = parts[i] && parts[i] !== "equation" ? ` ${parts[i]}` : "";
    const inlay = key && starts.has(i + 1) && app.sem.vars.get(key)?.cells.length ? `<span class="inlay" data-live="v:${escapeHtml(key)}"></span>` : "";
    return `<div class="ln${key ? " def" : ""}${part}${set ? (set[0].whatIf ? " replaced" : " fitted") : ""}"${attrs}><i>${i + 1}</i><code>${lineHtml(line)}${inlay}</code>${set ? setHtml(set) : ""}</div>`;
  });
  return `<div class="code">${rows.join("")}${note}</div>`;
}

// A Vensim definition is "name = equation ~ units ~ comment |": each line belongs to the part the
// last "~" before it opened.
function definitionParts(lines: string[]): ("equation" | "units" | "comment")[] {
  const names = ["equation", "units", "comment"] as const;
  let part = 0;
  return lines.map((line) => {
    const tildes = line.trimStart().match(/^(~\s*)+/)?.[0].split("~").length ?? 1;
    part = Math.min(2, part + tildes - 1);
    const name = names[part];
    if (/\|\s*$/.test(line)) part = 0;
    return name;
  });
}

// The "\" that continues a line in Vensim is faint, so the text reads as prose.
function lineHtml(line: string): string {
  if (!line) return " ";
  const continued = line.match(/^(.*?)\s*\\$/);
  return continued ? `${escapeHtml(continued[1])} <span class="cont">\\</span>` : escapeHtml(line);
}

function setHtml(settings: Setting[]): string {
  const value = (s: Setting) => `${s.target.includes("[") ? escapeHtml(s.target.slice(s.target.indexOf("["))) + " " : ""}= ${s.value}`;
  const shown = settings.slice(0, SHOWN_VALUES).map(value).join(", ");
  const more = settings.length > SHOWN_VALUES ? ` +${settings.length - SHOWN_VALUES} more` : "";
  const file = settings[0].file;
  return `<a class="set-to" data-open="source:${escapeHtml(file)}>var:${escapeHtml(parseCellName(settings[0].target).variable)}">${shown}${more} <small>${escapeHtml(file.split("/").pop()!)}</small></a>`;
}

// A replaced definition is struck out down to the line that closes it.
function markReplaced(body: HTMLElement) {
  const lines = [...body.querySelectorAll<HTMLElement>(".ln")];
  lines.forEach((el, i) => {
    if (!el.classList.contains("replaced")) return;
    for (let j = i + 1; j < blockEnd(lines, i + 1); j++) lines[j].classList.add("replaced");
  });
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
