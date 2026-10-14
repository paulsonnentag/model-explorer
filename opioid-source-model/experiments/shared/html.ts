// HTML helpers shared by the experiments.

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// A link to the server's source viewer, highlighting a line (or the first line containing `find`).
export function sourceLink(file: string, line?: number, find?: string): string {
  const params = new URLSearchParams({ file });
  if (line) params.set("line", String(line));
  if (find) params.set("find", find);
  return `/source?${params}`;
}

// A link that opens a variable in the Explorer experiment, optionally under a given what-if.
export function explorerLink(key: string, query = ""): string {
  return `/01-explorer/${query ? `?${query}` : ""}#${encodeURIComponent(key)}`;
}
