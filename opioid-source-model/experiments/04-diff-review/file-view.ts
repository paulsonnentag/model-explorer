// Any file, as it is after the change ("model.mdl") or before it ("model.mdl@base"), with the lines the
// change adds or removes marked. In model.mdl each definition's first line lights up what it stands for
// on the map.

import { escapeHtml } from "../shared/html.ts";
import type { PanelView, ReviewApp } from "./app.ts";
import { applyPatch } from "../core/patch.ts";

const SKETCH_MARKER = "\\\\\\---///";

export const filePanel: PanelView = {
  width: () => 620,
  kind: (_, id) => (id.endsWith("@base") ? "File · before the change" : "File · after the change"),
  title: (_, id) => id.replace(/@base$/, ""),
  render(body, app, id) {
    body.innerHTML = `<div class="src-info"></div><div class="code muted">Loading…</div>`;
    textOf(app, id).then((text) => {
      body.querySelector(".code")!.outerHTML = codeHtml(app, id, text);
      const spec = app.focus.get(`source:${id}`);
      if (spec) filePanel.focus!(body, app, id, spec);
    });
  },
  focus(body, app, id, spec) {
    const [kind, ...rest] = spec.split(":");
    const target = rest.join(":");
    const lines = [...body.querySelectorAll<HTMLElement>(".ln:not(.note)")];
    if (!lines.length) return;
    const side = id.endsWith("@base") ? app.review.base : app.review.head;
    const start = kind === "line" ? Number(target) : (side.mdl.definitions.find((d) => d.key === target)?.line ?? 0);
    if (!start || !lines[start - 1]) return;
    let end = start;
    while (end < lines.length && end < start + 60 && !/\|\s*$/.test(lines[end - 1].querySelector("code")!.textContent!)) end++;
    lines.forEach((el, i) => el.classList.toggle("hit", i + 1 >= start && i + 1 <= end));
    lines[start - 1].scrollIntoView({ block: "center" });
    const name = side.mdl.definitions.find((d) => d.key === target)?.name;
    body.querySelector(".src-info")!.innerHTML = name ? `<b>${escapeHtml(name)}</b> · line ${start}` : "";
  },
  source: (_, id) => (id.startsWith("changes/") ? `<a href="/model/${escapeHtml(id)}" target="_blank">open the raw file</a>` : `<span class="muted">opioid-model/${escapeHtml(id.replace(/@base$/, ""))}</span>`),
};

async function textOf(app: ReviewApp, id: string): Promise<string> {
  const r = app.review;
  if (id === "model.mdl") return r.head.text;
  if (id === "model.mdl@base") return r.base.text;
  if (app.texts.has(id)) return app.texts.get(id)!;
  const patch = r.files.find((f) => f.patch.path === id && f.patch.isNew)?.patch;
  if (patch) return applyPatch("", patch);
  return (await fetch(`/model/${id}`)).text();
}

// model.mdl stops before the diagrams, which are the same model drawn.
function codeHtml(app: ReviewApp, id: string, text: string): string {
  const path = id.replace(/@base$/, "");
  const before = id.endsWith("@base");
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  let note = "";
  const starts = new Map<number, string>();
  if (path === "model.mdl") {
    const sketch = lines.findIndex((l) => l.startsWith(SKETCH_MARKER));
    if (sketch > 0) {
      note = `<div class="ln note">The rest of the file (${lines.length - sketch} lines) draws the authors' diagrams.</div>`;
      lines = lines.slice(0, sketch);
    }
    for (const d of (before ? app.review.base : app.review.head).mdl.definitions) if (!starts.has(d.line)) starts.set(d.line, d.key);
  }
  const marked = new Set(
    app.review.files
      .filter((f) => f.patch.path === path)
      .flatMap((f) => f.hunks.flatMap((h) => h.hunk.lines))
      .filter((l) => l.kind === (before ? "-" : "+"))
      .map((l) => (before ? l.oldLine : l.newLine)!),
  );
  const rows = lines.map((line, i) => {
    const key = starts.get(i + 1);
    const attrs = key ? ` data-hover="var:${escapeHtml(key)}" data-var="${escapeHtml(key)}"` : "";
    const cls = `ln${key ? " def" : ""}${marked.has(i + 1) ? (before ? " del" : " add") : ""}`;
    return `<div class="${cls}"${attrs}><i>${i + 1}</i><code>${escapeHtml(line) || " "}</code></div>`;
  });
  const first = rows.findIndex((_, i) => marked.has(i + 1));
  const jump = marked.size ? `<div class="ln note">${marked.size} line${marked.size === 1 ? "" : "s"} ${before ? "removed" : "added or changed"} by the change, marked; the first is line ${first + 1}.</div>` : "";
  return `<div class="code">${jump}${rows.join("")}${note}</div>`;
}
