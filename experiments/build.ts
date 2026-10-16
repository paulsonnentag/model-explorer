// Builds the experiments into a static site for GitHub Pages. Usage: node experiments/build.ts [out]
// (default: dist/ at the repository root).
//
// The site has the layout serve.ts serves: the pages and their assets, the TypeScript each page loads
// with its types stripped, api/model.json and api/changes.json written from opioid-model/, and
// opioid-model/ itself as model/.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { loadChanges, loadModelFolder, MODEL_DIR } from "./core/model-folder.ts";

const EXPERIMENTS_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(process.argv[2] ?? join(EXPERIMENTS_DIR, "..", "dist"));
const ASSETS = new Set([".css", ".jpg", ".png", ".svg", ".mjs"]);
const IMPORT = /(\bfrom\s*|\bimport\s*)(["'])(\.{1,2}\/[^"']+)\.ts\2/g;

build();

function build() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  const pages = files(EXPERIMENTS_DIR).filter((f) => f.endsWith("index.html"));
  for (const page of pages) writePage(page);
  for (const module of reachableModules(pages)) writeModule(module);
  for (const asset of files(EXPERIMENTS_DIR).filter((f) => ASSETS.has(extname(f)) || f.startsWith("vendor/"))) copy(asset);
  write("api/model.json", JSON.stringify(loadModelFolder()));
  write("api/changes.json", JSON.stringify(loadChanges()));
  cpSync(MODEL_DIR, join(OUT_DIR, "model"), { recursive: true, filter: (src) => !src.endsWith(".DS_Store") });
  console.log(`Built ${pages.length} pages into ${relative(process.cwd(), OUT_DIR) || "."}`);
}

function writePage(page: string) {
  write(page, read(page).replace(/(<script[^>]*\ssrc=")([^"]+)\.ts"/g, '$1$2.js"'));
}

function writeModule(module: string) {
  write(module.replace(/\.ts$/, ".js"), toJs(module).replace(IMPORT, "$1$2$3.js$2"));
}

// The TypeScript modules the pages load, following the imports that survive type stripping.
function reachableModules(pages: string[]): string[] {
  const seen = new Set<string>();
  const visit = (module: string) => {
    if (seen.has(module)) return;
    seen.add(module);
    for (const [, , , path] of toJs(module).matchAll(IMPORT)) visit(join(dirname(module), `${path}.ts`));
  };
  for (const page of pages) {
    for (const [, src] of read(page).matchAll(/<script[^>]*\ssrc="([^"]+\.ts)"/g)) visit(join(dirname(page), src));
  }
  return [...seen];
}

function toJs(module: string): string {
  return stripTypeScriptTypes(read(module), { mode: "strip" });
}

function files(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix + entry.name;
    return entry.isDirectory() ? files(join(dir, entry.name), `${path}/`) : [path];
  });
}

function read(path: string): string {
  return readFileSync(join(EXPERIMENTS_DIR, path), "utf-8");
}

function copy(path: string) {
  mkdirSync(dirname(join(OUT_DIR, path)), { recursive: true });
  cpSync(join(EXPERIMENTS_DIR, path), join(OUT_DIR, path));
}

function write(path: string, text: string) {
  mkdirSync(dirname(join(OUT_DIR, path)), { recursive: true });
  writeFileSync(join(OUT_DIR, path), text);
}
