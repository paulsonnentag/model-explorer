// Serves the visualization experiments while working on them. Usage: node experiments/serve.ts [port]
//
// The browser code is TypeScript; it is served as JavaScript by stripping the types on the fly, so
// there is no build step. The site is laid out as build.ts writes it for GitHub Pages:
// api/model.json and model/<path> serve opioid-model/ (the trail view); api/changes.json the files in
// its changes/ folder (the diff review).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { loadChanges, loadModelFolder, MODEL_DIR } from "./core/model-folder.ts";

const EXPERIMENTS_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 4173);

createServer((req, res) => {
  try {
    route(req, res);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String((error as Error).stack));
  }
}).listen(PORT, () => console.log(`SOURCE model explorer: http://localhost:${PORT}/`));

function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/model.json") return sendJson(res, loadModelFolder());
  if (url.pathname === "/api/changes.json") return sendJson(res, loadChanges());
  const path = decodeURIComponent(url.pathname);
  if (path.startsWith("/model/")) return sendWithin(res, MODEL_DIR, path.slice("/model".length));
  sendWithin(res, EXPERIMENTS_DIR, path.endsWith("/") ? `${path}index.html` : path);
}

function sendWithin(res: ServerResponse, root: string, path: string) {
  const file = normalize(join(root, path));
  if (!file.startsWith(root) || !existsSync(file)) return res.writeHead(404).end("Not found");
  if (statSync(file).isDirectory()) return res.writeHead(302, { location: `${path}/` }).end();
  sendFile(res, file);
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
    ".jpg": "image/jpeg",
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
