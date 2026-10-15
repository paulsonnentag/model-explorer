// Reads unified diffs (as written by git) and applies them, forwards or in reverse. Runs in Node and in
// the browser. Lines keep their "\r", so files with Windows line endings round-trip unchanged.

export type HunkLine = { kind: " " | "+" | "-"; text: string; oldLine: number | null; newLine: number | null };

export type Hunk = { oldStart: number; newStart: number; header: string; lines: HunkLine[] };

export type FilePatch = { path: string; isNew: boolean; hunks: Hunk[] };

export function parsePatch(text: string): FilePatch[] {
  const files: FilePatch[] = [];
  let file: FilePatch | null = null;
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      file = { path: raw.split(" b/").pop()!.trim(), isNew: false, hunks: [] };
      files.push(file);
      hunk = null;
    } else if (!file) {
      continue;
    } else if (raw.startsWith("new file mode")) {
      file.isNew = true;
    } else if (raw.startsWith("@@")) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/)!;
      oldLine = Number(m[1]);
      newLine = Number(m[2]);
      hunk = { oldStart: oldLine, newStart: newLine, header: m[3].replace(/\r$/, ""), lines: [] };
      file.hunks.push(hunk);
    } else if (hunk && (raw[0] === " " || raw[0] === "+" || raw[0] === "-") && !raw.startsWith("--- ") && !raw.startsWith("+++ ")) {
      const kind = raw[0] as HunkLine["kind"];
      hunk.lines.push({ kind, text: raw.slice(1), oldLine: kind === "+" ? null : oldLine, newLine: kind === "-" ? null : newLine });
      if (kind !== "+") oldLine++;
      if (kind !== "-") newLine++;
    }
  }
  return files;
}

// The file after the patch, or before it when `reverse`; throws when the context does not match.
export function applyPatch(text: string, file: FilePatch, reverse = false): string {
  const source = file.isNew && !reverse ? [] : text.split("\n");
  const out: string[] = [];
  let at = 0;
  for (const hunk of file.hunks) {
    const start = (reverse ? hunk.newStart : hunk.oldStart) - 1;
    const from = hunk.lines.filter((l) => l.kind === " " || l.kind === (reverse ? "+" : "-")).map((l) => l.text);
    const to = hunk.lines.filter((l) => l.kind === " " || l.kind === (reverse ? "-" : "+")).map((l) => l.text);
    // A hunk that only adds lines is numbered by the line it follows.
    const begin = from.length === 0 ? start + 1 : start;
    out.push(...source.slice(at, begin));
    if (source.slice(begin, begin + from.length).join("\n") !== from.join("\n")) throw new Error(`${file.path}: hunk at line ${start + 1} does not apply`);
    out.push(...to);
    at = begin + from.length;
  }
  out.push(...source.slice(at));
  return file.isNew && !reverse ? out.join("\n") + "\n" : out.join("\n");
}
