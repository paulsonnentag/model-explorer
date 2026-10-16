// The list of changes to pick from, and one change laid out like a pull request: its description, and
// the files it changes, as model changes or as the raw diff. Anything it touches links out to the map,
// the loops and the results.

import { escapeHtml } from "../shared/html.ts";
import type { PanelView, ReviewApp } from "./app.ts";
import type { ChangeFile } from "./change-file.ts";
import { modelChangesHtml, rawDiffHtml } from "./diff-view.ts";

const GITHUB = "https://github.com/FDA/SOURCE/commit/";
const tabs = new Map<string, "conversation" | "files">();

export function showFiles(changeId: string) {
  tabs.set(changeId, "files");
}

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
    const files = app.review.files.length;
    body.innerHTML = `<div class="pr-head">
        <div class="pr-meta">${stateBadge(change)} ${metaHtml(change)}</div>
        <nav class="tabs">
          <button data-tab="conversation" class="${tab === "conversation" ? "on" : ""}">Conversation</button>
          <button data-tab="files" class="${tab === "files" ? "on" : ""}">Files changed <span class="count">${files}</span></button>
        </nav>
      </div>
      <div class="pr-body">${tab === "conversation" ? descriptionHtml(change) : app.diffView === "model" ? modelChangesHtml(app) : rawDiffHtml(app)}</div>`;
    body.onclick = (e) => {
      const target = e.target as Element;
      if (target.closest("[data-open]")) return;
      const more = target.closest<HTMLElement>("[data-more]");
      if (more) {
        more.closest(".chips")!.classList.add("all");
        more.remove();
        return;
      }
      const viewLink = target.closest<HTMLElement>("[data-view]");
      if (viewLink) return app.setDiffView(viewLink.dataset.view as ReviewApp["diffView"]);
      const tabButton = target.closest<HTMLElement>("[data-tab]");
      if (!tabButton) return;
      tabs.set(change.id, tabButton.dataset.tab as "conversation" | "files");
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

// The description as the author wrote it, in one comment, as a pull request opens.
function descriptionHtml(change: ChangeFile): string {
  const caveat = change.caveat ? `<h4>Caveat</h4>${markdown(change.caveat)}` : "";
  return `<div class="comment">
    <div class="comment-head"><b>${escapeHtml(change.author)}</b> <span class="muted">commented on ${escapeHtml(change.date)}</span></div>
    <div class="comment-body">${markdown(change.description)}${caveat}</div>
  </div>`;
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
