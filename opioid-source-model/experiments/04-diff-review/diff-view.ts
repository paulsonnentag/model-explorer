// The "Files changed" tab, two ways. "Model changes" lists what the change does to the model: the
// definitions it changes, the constants every run sees differently, what has no effect, and what is not
// the model at all. "Raw diff" is the text diff as git shows it, with each hunk labelled by what it
// amounts to and the noise folded away.

import { HUNK_KINDS, type DefinitionChange } from "../core/model-diff.ts";
import type { HunkLine } from "../core/patch.ts";
import { escapeHtml } from "../shared/html.ts";
import { FAMILIES, loopTitle } from "../shared/loops.ts";
import { nameOf } from "../03-stock-map/context.ts";
import type { ReviewApp } from "./app.ts";
import { isNoise, type FileDiff, type ReviewHunk, type Setting } from "./review.ts";

const SHOWN_FLOWS = 6;

// Noise hunks start folded; these are the ones unfolded, by "changeId:path:index".
const expanded = new Set<string>();

export function toggleHunk(id: string) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
}

// The variables the runs see differently: changed equations, and constants whose value in a run changes.
export function effective(app: ReviewApp): string[] {
  const r = app.review;
  const set = new Set(r.settings.map((s) => s.key));
  const computed = r.definitions.filter((d) => d.kind === "equation" || d.kind === "added" || d.kind === "removed").map((d) => d.key);
  return [...new Set([...computed, ...set])];
}

export function modelChangesHtml(app: ReviewApp): string {
  const r = app.review;
  const settingsByKey = groupSettings(r.settings);
  const effects = new Set(effective(app));
  const shown = r.definitions.filter((d) => effects.has(d.key));
  const fromFiles = [...settingsByKey].filter(([key]) => !shown.some((d) => d.key === key));
  const idle = r.definitions.filter((d) => !effects.has(d.key));
  const noise = r.files.flatMap((f) => f.hunks.filter((h) => isNoise(h.kind) || h.kind === "changelog"));
  return `${shown.length ? `<h3>Changes what the model computes <span class="count">${shown.length}</span></h3>${shown.map((d) => definitionCard(app, d, settingsByKey.get(d.key))).join("")}` : ""}
    ${fromFiles.length ? `<h3>Changes what every run sees <span class="count">${fromFiles.length}</span></h3><p class="hint">Set by the change's files on top of the fitted values; the equations stay as they are.</p>${fromFiles.map(([key, settings]) => settingCard(app, key, settings)).join("")}` : ""}
    ${idle.length ? `<details><summary>No effect on the runs <span class="count">${idle.length}</span></summary>${idle.map((d) => idleRow(app, d)).join("")}</details>` : ""}
    ${noise.length ? `<details><summary>Not the model <span class="count">${noise.length} hunks</span></summary>${noiseRows(noise)}<p class="hint"><a data-view="raw">See them in the raw diff</a></p></details>` : ""}`;
}

export function rawDiffHtml(app: ReviewApp): string {
  const r = app.review;
  const hunks = r.files.flatMap((f) => f.hunks);
  const folded = hunks.filter((h) => isNoise(h.kind)).length;
  const note = folded ? `<p class="hint">${folded} of ${hunks.length} hunks are not the model (Vensim rewrites its diagrams, settings and number formats on every save) and are folded.</p>` : "";
  return note + r.files.map((file) => fileHtml(app, file)).join("");
}

export function flowChips(app: ReviewApp, flows: string[]): string {
  const chips = flows.slice(0, SHOWN_FLOWS).map((f) => `<a class="chip flow-chip" data-open="map>flow:${escapeHtml(f)}" data-hover="flow:${escapeHtml(f)}" data-var="${escapeHtml(f)}">${escapeHtml(nameOf(app, f))}</a>`);
  const rest = flows.slice(SHOWN_FLOWS);
  if (rest.length) chips.push(`<a class="chip more-chip" data-open="map>flow:${escapeHtml(rest.join("|"))}" data-hover="flow:${escapeHtml(rest.join("|"))}">+${rest.length} more</a>`);
  return chips.join("");
}

export function loopChips(app: ReviewApp, loops: string[]): string {
  return loops
    .map((id) => {
      const loop = app.loops.find((l) => l.id === id);
      const color = loop ? FAMILIES[loop.family].color : "#888";
      return `<a class="chip loop-chip" style="--c:${color}" data-open="loop:${escapeHtml(id)}" data-hover="loop:${escapeHtml(id)}">${escapeHtml(loop ? loopTitle(loop, app.plain) : id)}</a>`;
    })
    .join("");
}

function definitionCard(app: ReviewApp, d: DefinitionChange, settings: Setting[] | undefined): string {
  const acts = app.review.actsOn.get(d.key);
  const isStock = app.review.head.sem.vars.get(d.key)?.role === "stock" || app.review.base.sem.vars.get(d.key)?.role === "stock";
  const where = isStock
    ? `<div class="mc-acts">The box on the map: <a class="chip stock-chip" data-open="map>stock:${escapeHtml(d.key)}" data-hover="stock:${escapeHtml(d.key)}">${escapeHtml(nameOf(app, d.key))}</a></div>`
    : actsHtml(app, acts);
  return `<div class="mc" data-hover="${escapeHtml(hoverOf(app, d.key))}" data-var="${escapeHtml(d.key)}">
    <div class="mc-head"><span class="badge ${d.kind}">${escapeHtml(HUNK_KINDS[d.kind].label)}</span><b>${escapeHtml(d.name)}</b>${lineLinks(d)}</div>
    ${definitionDiff(d)}
    ${settings ? valuesHtml(settings) : ""}
    ${where}
  </div>`;
}

function settingCard(app: ReviewApp, key: string, settings: Setting[]): string {
  const name = app.review.head.sem.vars.get(key)?.modelName ?? key;
  return `<div class="mc" data-hover="${escapeHtml(hoverOf(app, key))}" data-var="${escapeHtml(key)}">
    <div class="mc-head"><span class="badge constant">Set by ${escapeHtml(settings[0].file.split("/").pop()!)}</span><b>${escapeHtml(name)}</b><a class="src" data-open="source:model.mdl>var:${escapeHtml(key)}">model.mdl</a></div>
    ${valuesHtml(settings)}
    ${actsHtml(app, app.review.actsOn.get(key))}
  </div>`;
}

function idleRow(app: ReviewApp, d: DefinitionChange): string {
  const cell = app.review.head.sem.vars.get(d.key)?.cells[0];
  const setBy = cell === undefined ? "model.mdl" : app.review.head.setBy[cell];
  const reason =
    d.kind === "documentation"
      ? "Only the comment or units changed."
      : d.kind === "rounding"
        ? `Vensim re-printed the number with fewer digits${setBy !== "model.mdl" ? `, and every run sets it from ${setBy.split("/").pop()} anyway` : ""}.`
        : `Every run sets it from ${setBy.split("/").pop()}, so the value in model.mdl is not used.`;
  return `<div class="idle" data-hover="${escapeHtml(hoverOf(app, d.key))}" data-var="${escapeHtml(d.key)}"><span class="badge ${d.kind}">${escapeHtml(HUNK_KINDS[d.kind].label)}</span><b>${escapeHtml(d.name)}</b>${lineLinks(d)}<p>${escapeHtml(reason)}</p>${definitionDiff(d)}</div>`;
}

function noiseRows(hunks: ReviewHunk[]): string {
  const counts = new Map<string, { hunks: number; lines: number; sample: string }>();
  for (const h of hunks) {
    const changed = h.hunk.lines.filter((l) => l.kind !== " ");
    const entry = counts.get(h.kind) ?? { hunks: 0, lines: 0, sample: "" };
    entry.hunks++;
    entry.lines += changed.length;
    if (h.kind === "changelog") entry.sample = changed.find((l) => /^\d{6} - /.test(l.text))?.text ?? "";
    counts.set(h.kind, entry);
  }
  return [...counts]
    .map(([kind, c]) => `<div class="idle"><span class="badge ${kind}">${escapeHtml(HUNK_KINDS[kind as keyof typeof HUNK_KINDS].label)}</span>${c.hunks} hunk${c.hunks === 1 ? "" : "s"}, ${c.lines} changed lines${c.sample ? `<blockquote>${escapeHtml(c.sample)}</blockquote>` : ""}</div>`)
    .join("");
}

function actsHtml(app: ReviewApp, acts: { flows: string[]; loops: string[] } | undefined): string {
  if (!acts || (!acts.flows.length && !acts.loops.length)) return "";
  return `<div class="mc-acts">${acts.loops.length ? `Strength of ${loopChips(app, acts.loops)} ` : ""}${acts.flows.length ? `Acts on ${flowChips(app, acts.flows)}` : ""}</div>`;
}

function valuesHtml(settings: Setting[]): string {
  const rows = settings.map((s) => {
    const element = s.cell.includes("[") ? `<i>${escapeHtml(s.cell.slice(s.cell.indexOf("[")))}</i> ` : "";
    return `<span>${element}<del>${s.before === null ? "new" : formatValue(s.before)}</del> → <ins>${formatValue(s.after)}</ins></span>`;
  });
  return `<div class="mc-values"><span class="muted">Every run sees</span> ${rows.join("")}</div>`;
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
}

function lineLinks(d: DefinitionChange): string {
  const before = d.before && !d.after ? `<a class="src" data-open="source:model.mdl@base>var:${escapeHtml(d.key)}">before: model.mdl:${d.before.line}</a>` : "";
  const after = d.after ? `<a class="src" data-open="source:model.mdl>var:${escapeHtml(d.key)}">model.mdl:${d.after.line}</a>` : "";
  return before + after;
}

// The definition's text before and after, line by line.
function definitionDiff(d: DefinitionChange): string {
  const before = d.before ? d.before.text.split("\n") : [];
  const after = d.after ? d.after.text.split("\n") : [];
  return `<div class="mini-diff">${lineDiff(before, after)
    .map((l) => `<div class="${l.kind === "+" ? "add" : l.kind === "-" ? "del" : "ctx"}"><span>${l.kind === " " ? " " : l.kind}</span>${escapeHtml(l.text) || " "}</div>`)
    .join("")}</div>`;
}

function lineDiff(a: string[], b: string[]): { kind: " " | "+" | "-"; text: string }[] {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: { kind: " " | "+" | "-"; text: string }[] = [];
  let [i, j] = [0, 0];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: " ", text: a[i++] });
      j++;
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) out.push({ kind: "-", text: a[i++] });
    else out.push({ kind: "+", text: b[j++] });
  }
  return out;
}

function fileHtml(app: ReviewApp, file: FileDiff): string {
  const path = file.patch.path;
  const hunks = file.hunks.map((h, i) => hunkHtml(app, `${app.review.change.id}:${path}:${i}`, h)).join("");
  return `<div class="diff-file">
    <div class="file-head"><b>${escapeHtml(path)}</b>${file.patch.isNew ? ` <span class="badge added">new file</span>` : ""} <span class="adds">+${file.added}</span> <span class="dels">−${file.removed}</span>
      <a class="src" data-open="source:${escapeHtml(path)}">view file</a></div>
    ${hunks}
  </div>`;
}

function hunkHtml(app: ReviewApp, id: string, h: ReviewHunk): string {
  const noise = isNoise(h.kind);
  const open = !noise || expanded.has(id);
  const changed = h.hunk.lines.filter((l) => l.kind !== " ").length;
  const names = h.keys.map((k) => `<a class="chip" data-hover="${escapeHtml(hoverOf(app, k))}" data-var="${escapeHtml(k)}" data-open="source:model.mdl>var:${escapeHtml(k)}">${escapeHtml(app.review.head.sem.vars.get(k)?.modelName ?? k)}</a>`).join("");
  const head = `<div class="hunk-head"${noise ? ` data-expand="${escapeHtml(id)}"` : ""}>
    <span class="badge ${h.kind}">${escapeHtml(HUNK_KINDS[h.kind].label)}</span>
    <code>@@ −${h.hunk.oldStart} +${h.hunk.newStart} @@ ${escapeHtml(h.hunk.header)}</code>${names}
    ${noise ? `<span class="fold">${changed} lines · ${open ? "hide" : "show"}</span>` : ""}</div>`;
  return `<div class="hunk${noise ? " noise" : ""}">${head}${open ? `<table class="diff">${h.hunk.lines.map(rowHtml).join("")}</table>` : ""}</div>`;
}

function rowHtml(line: HunkLine): string {
  const cls = line.kind === "+" ? "add" : line.kind === "-" ? "del" : "ctx";
  return `<tr class="${cls}"><td class="lineno">${line.oldLine ?? ""}</td><td class="lineno">${line.newLine ?? ""}</td><td class="text"><span>${line.kind === " " ? " " : line.kind}</span>${escapeHtml(line.text.replace(/\r$/, "")) || " "}</td></tr>`;
}

// Flows light up their arrows, groups their boxes, anything else what it is computed from.
function hoverOf(app: ReviewApp, key: string): string {
  if (app.layout.edges.some((e) => e.flows.some((f) => f.key === key))) return `flow:${key}`;
  if (app.layout.nodes.some((n) => n.key === key)) return `stock:${key}`;
  return `var:${key}`;
}

function groupSettings(settings: Setting[]): Map<string, Setting[]> {
  const out = new Map<string, Setting[]>();
  for (const s of settings) out.set(s.key, [...(out.get(s.key) ?? []), s]);
  return out;
}
