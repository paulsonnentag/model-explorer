// A change as described in opioid-model/changes/NN-name.md: front matter saying what it changes and
// how, then a description in Markdown with optional "## Published" and "## Caveat" sections.
//
// `patch` is a unified diff of files in opioid-model/. A merged change is already in those files, so
// the version before it is the patch applied in reverse; an open change applies on top of them.
// `adds` lists what-if files the change adds to every run, after the fitted values.

export type ChangeFile = {
  id: string;
  number: number;
  file: string;
  title: string;
  author: string;
  date: string;
  status: "merged" | "open";
  commit: string | null;
  kind: string;
  patch: string | null;
  adds: string[];
  published: string | null;
  description: string;
  publishedNotes: string[];
  caveat: string;
};

export function parseChangeFile(file: string, raw: string): ChangeFile {
  const text = raw.replace(/\r\n?/g, "\n");
  const [, front = "", body = text] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  const meta = new Map(front.split("\n").map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]));
  const sections = body.split(/^## /m);
  const section = (name: string) => sections.find((s) => s.startsWith(`${name}\n`))?.slice(name.length + 1).trim() ?? "";
  const id = file.split("/").pop()!.replace(/\.md$/, "");
  return {
    id,
    number: Number(id.split("-")[0]),
    file,
    title: meta.get("title") ?? id,
    author: meta.get("author") ?? "",
    date: meta.get("date") ?? "",
    status: meta.get("status") === "merged" ? "merged" : "open",
    commit: meta.get("commit") || null,
    kind: meta.get("kind") ?? "",
    patch: meta.get("patch") || null,
    adds: (meta.get("adds") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    published: meta.get("published") || null,
    description: sections[0].trim(),
    publishedNotes: section("Published").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)),
    caveat: section("Caveat"),
  };
}
