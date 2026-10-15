// Serves the visualization experiments. Usage: node opioid-source-model/experiments/serve.ts [port]
//
// The browser code is TypeScript; it is served as JavaScript by stripping the types on the fly,
// so there is no build step. Everything else is read straight from the SOURCE repository.
// /files/<path> serves anything under opioid-source-model/ (the paper PDF, the repository's figures).
// /api/model and /model/<path> serve the sorted copy in opioid-source-model/opioid-model/ (the trail view);
// /api/changes the files in its changes/ folder (the diff review).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { loadBundle, publishedRunFile, readTab, REPO_DIR, type Bundle } from "./core/inputs.ts";
import { loadModelFolder, MODEL_DIR } from "./core/model-folder.ts";

const EXPERIMENTS_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(EXPERIMENTS_DIR, "..");
const PORT = Number(process.argv[2] ?? 4173);
const SAMPLE_COUNT = 400;

let bundle: Bundle | null = null;

createServer((req, res) => {
  try {
    route(req, res);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String((error as Error).stack));
  }
}).listen(PORT, () => console.log(`SOURCE model explorer: http://localhost:${PORT}/`));

function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/bundle") return sendJson(res, browserBundle());
  if (url.pathname === "/api/model") return sendJson(res, loadModelFolder());
  if (url.pathname === "/api/changes") return sendJson(res, loadChanges());
  if (url.pathname.startsWith("/api/published/")) return sendPublished(res, url);
  if (url.pathname === "/source") return sendSource(res, url);
  const path = decodeURIComponent(url.pathname);
  if (path.startsWith("/files/")) return sendWithin(res, PROJECT_DIR, path.slice("/files".length));
  if (path.startsWith("/model/")) return sendWithin(res, MODEL_DIR, path.slice("/model".length));
  sendWithin(res, EXPERIMENTS_DIR, path.endsWith("/") ? `${path}index.html` : path);
}

function sendWithin(res: ServerResponse, root: string, path: string) {
  const file = normalize(join(root, path));
  if (!file.startsWith(root) || !existsSync(file)) return res.writeHead(404).end("Not found");
  if (statSync(file).isDirectory()) return res.writeHead(302, { location: `${path}/` }).end();
  sendFile(res, file);
}

function loadChanges(): { file: string; text: string }[] {
  const dir = join(MODEL_DIR, "changes");
  return readdirSync(dir)
    .sort()
    .map((name) => ({ file: `changes/${name}`, text: readFileSync(join(dir, name), "utf-8") }));
}

function browserBundle() {
  bundle ??= loadBundle();
  const every = Math.max(1, Math.floor(bundle.samples.rows.length / SAMPLE_COUNT));
  return { ...bundle, samples: { names: bundle.samples.names, rows: bundle.samples.rows.filter((_, i) => i % every === 0).slice(0, SAMPLE_COUNT) } };
}

// /api/published/<Scenario>?cells=key1|key2 returns Vensim's own results for those cells.
function sendPublished(res: ServerResponse, url: URL) {
  const scenario = decodeURIComponent(url.pathname.split("/").pop()!);
  const file = publishedRunFile(scenario);
  if (!file) return sendJson(res, {});
  const tab = readTab(file);
  const cells = (url.searchParams.get("cells") ?? "").split("|").filter(Boolean);
  const result: Record<string, (number | null)[]> = {};
  for (const key of cells) {
    const row = tab.rows.get(key);
    if (row) result[key] = Array.from(row, (v) => (Number.isNaN(v) ? null : v));
  }
  sendJson(res, { file, times: tab.times, series: result });
}

// /source?file=<repo path>&line=<n> (or &find=<text>) shows a repository file with that line highlighted.
function sendSource(res: ServerResponse, url: URL) {
  const relative = url.searchParams.get("file") ?? "";
  const path = normalize(join(REPO_DIR, relative));
  if (!path.startsWith(REPO_DIR) || !existsSync(path)) return res.writeHead(404).end("Not found");
  const lines = readFileSync(path, "utf-8").replace(/\r\n?/g, "\n").split("\n");
  const find = url.searchParams.get("find")?.toLowerCase().trim();
  const line = find ? lines.findIndex((l) => l.toLowerCase().includes(find)) + 1 : Number(url.searchParams.get("line") ?? 0);
  const rows = lines
    .map((text, i) => `<tr id="L${i + 1}"${i + 1 === line ? ' class="hit"' : ""}><td>${i + 1}</td><td>${escapeHtml(text) || " "}</td></tr>`)
    .join("");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><meta charset="utf-8">
<title>${escapeHtml(relative)}</title>
<style>
body{margin:0;font:12px/1.5 ui-monospace,Menlo,monospace;background:#fbfaf7;color:#222}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:8px 14px;font-family:system-ui;font-size:13px}
table{border-collapse:collapse}td{padding:0 10px;white-space:pre;vertical-align:top}
td:first-child{color:#aaa;text-align:right;user-select:none}
tr.hit td{background:#fff1b8}
</style>
<header>${escapeHtml(relative)}</header>
<table>${rows}</table>
<script>document.getElementById("L${line}")?.scrollIntoView({block:"center"})</script>`);
}

function sendFile(res: ServerResponse, file: string) {
  const ext = extname(file);
  if (ext === ".ts") {
    const js = stripTypeScriptTypes(readFileSync(file, "utf-8"), { mode: "strip" });
    return res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }).end(js);
  }
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".pdf": "application/pdf",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".md": "text/plain; charset=utf-8",
    ".mdl": "text/plain; charset=utf-8",
    ".cin": "text/plain; charset=utf-8",
    ".out": "text/plain; charset=utf-8",
    ".tsv": "text/plain; charset=utf-8",
  };
  res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream", "cache-control": "no-store" }).end(readFileSync(file));
}

function sendJson(res: ServerResponse, value: unknown) {
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(value));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
