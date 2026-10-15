// The list of changes to pick from, and one change laid out like a pull request: what it is for, what
// it changes in the model and the runs, and the files it changes. Anything it touches links out to the
// map, the loops and the results.

import { escapeHtml } from "../shared/html.ts";
import { FAMILIES } from "../shared/loops.ts";
import { formatNumber } from "../shared/chart.ts";
import type { PanelView, ReviewApp } from "./app.ts";
import type { ChangeFile } from "./change-file.ts";
import { effective, flowChips, loopChips, modelChangesHtml, rawDiffHtml, toggleHunk } from "./diff-view.ts";
import { FITTED } from "./review.ts";

const GITHUB = "https://github.com/FDA/SOURCE/commit/";
const tabs = new Map<string, "conversation" | "files">();
const views = new Map<string, "model" | "raw">();

export const changesPanel: PanelView = {
  width: () => 420,
  kind: () => "Changes",
  title: () => "Changes to the model",
  render(body, app) {
    body.innerHTML = `<p class="hint">One change the authors made after publishing, and four proposed ones built from their own files. Pick one to review it.</p>
      <div class="pr-list">${app.changes.map((c) => rowHtml(app, c)).join("")}</div>`;
  },
  source: (app) => app.changes.map((c) => `<a data-open="source:${escapeHtml(c.file)}">${escapeHtml(c.file.split("/").pop()!)}</a>`).join(" "),
};

export const changePanel: PanelView = {
  width: () => 760,
  kind: (app) => `Change #${app.review.change.number} · ${app.review.change.kind}`,
  title: (app) => app.review.change.title,
  render(body, app) {
    const change = app.review.change;
    const tab = tabs.get(change.id) ?? "conversation";
    const view = views.get(change.id) ?? "model";
    const files = app.review.files.length;
    body.innerHTML = `<div class="pr-head">
        <div class="pr-meta">${stateBadge(change)} ${metaHtml(change)}</div>
        <nav class="tabs">
          <button data-tab="conversation" class="${tab === "conversation" ? "on" : ""}">Conversation</button>
          <button data-tab="files" class="${tab === "files" ? "on" : ""}">Files changed <span class="count">${files}</span></button>
          ${tab === "files" ? `<span class="views"><button data-view="model" class="${view === "model" ? "on" : ""}">Model changes</button><button data-view="raw" class="${view === "raw" ? "on" : ""}">Raw diff</button></span>` : ""}
        </nav>
      </div>
      <div class="pr-body">${tab === "conversation" ? conversationHtml(app) : view === "model" ? modelChangesHtml(app) : rawDiffHtml(app)}</div>`;
    body.onclick = (e) => {
      const target = e.target as Element;
      if (target.closest("[data-open]")) return;
      const tabButton = target.closest<HTMLElement>("[data-tab]");
      const viewButton = target.closest<HTMLElement>("[data-view]");
      const expand = target.closest<HTMLElement>("[data-expand]");
      if (tabButton) tabs.set(change.id, tabButton.dataset.tab as "conversation" | "files");
      else if (viewButton) {
        tabs.set(change.id, "files");
        views.set(change.id, viewButton.dataset.view as "model" | "raw");
      } else if (expand) toggleHunk(expand.dataset.expand!);
      else return;
      changePanel.render(body, app, change.id);
    };
  },
  source: (app) => `<a data-open="source:${escapeHtml(app.review.change.file)}">${escapeHtml(app.review.change.file)}</a>`,
};

function rowHtml(app: ReviewApp, change: ChangeFile): string {
  const selected = change.id === app.review.change.id;
  return `<a class="pr-row${selected ? " selected" : ""}" data-open="change:${escapeHtml(change.id)}">
    ${stateBadge(change, true)}
    <div><b>${escapeHtml(change.title)}</b> <span class="pr-kind">${escapeHtml(change.kind)}</span>
      <small>#${change.number} · ${metaHtml(change, true)}</small></div>
  </a>`;
}

function stateBadge(change: ChangeFile, small = false): string {
  const label = change.status === "merged" ? "Merged" : "Open";
  return `<span class="state ${change.status}${small ? " small" : ""}">${small ? "" : label}</span>`;
}

function metaHtml(change: ChangeFile, plain = false): string {
  const commit = change.commit ? (plain ? ` (${escapeHtml(change.commit)})` : ` <a href="${GITHUB}${escapeHtml(change.commit)}" target="_blank">${escapeHtml(change.commit)}</a>`) : "";
  const verb = change.status === "merged" ? "committed" : "proposed";
  return `<b>${escapeHtml(change.author)}</b> ${verb}${commit} on ${escapeHtml(change.date)}`;
}

// What the change is for, in the authors' or our words, then what it does in the model and the runs.
function conversationHtml(app: ReviewApp): string {
  const { change } = app.review;
  return `<div class="comment">${markdown(change.description)}</div>
    ${summaryHtml(app)}
    ${change.publishedNotes.length ? `<div class="comment"><h4>The authors' results</h4><ul>${change.publishedNotes.map((n) => `<li>${inline(n)}</li>`).join("")}</ul><a data-open="results">Compare with our runs</a></div>` : ""}
    ${change.caveat ? `<div class="comment caveat"><h4>Caveat</h4>${markdown(change.caveat)}</div>` : ""}`;
}

function summaryHtml(app: ReviewApp): string {
  const r = app.review;
  const effects = effective(app);
  const flows = [...new Set(effects.flatMap((key) => r.actsOn.get(key)?.flows ?? []))];
  const loops = [...new Set(effects.flatMap((key) => r.actsOn.get(key)?.loops ?? []))];
  const deaths = (side: typeof r.base) => side.runs.valueAt(side.runs.current(FITTED), "projected cumulative overdose deaths", Infinity);
  const [before, after] = [deaths(r.base), deaths(r.head)];
  const families = [...new Set(loops.map((id) => app.loops.find((l) => l.id === id)?.family).filter((f) => f !== undefined))];
  return `<div class="comment summary"><h4>What it changes</h4><ul>
      <li>${effects.length ? `${effects.length} variable${effects.length === 1 ? "" : "s"} computed or set differently: <a data-tab="files">see the model changes</a>` : "Nothing the runs see"}</li>
      ${flows.length ? `<li>Acts on ${flows.length} flow${flows.length === 1 ? "" : "s"} of people: ${flowChips(app, flows)}</li>` : ""}
      ${loops.length ? `<li>Changes the strength of ${families.map((f) => FAMILIES[f].title.toLowerCase()).join(", ")}: ${loopChips(app, loops)}</li>` : ""}
      <li>Projected overdose deaths 2020–2032: ${formatNumber(before)} → <b>${formatNumber(after)}</b> (${signed(after - before)}) <a data-open="results">Results</a></li>
    </ul></div>`;
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v))}`;
}

function markdown(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      if (block.startsWith("> ")) return `<blockquote>${inline(block.replace(/^> /gm, ""))}</blockquote>`;
      if (block.startsWith("- ")) return `<ul>${block.split("\n").map((l) => `<li>${inline(l.replace(/^- /, ""))}</li>`).join("")}</ul>`;
      return `<p>${inline(block)}</p>`;
    })
    .join("");
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}
