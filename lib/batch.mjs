// Batch-mode helpers for design-md CLI v0.6 (US-001).
// Pure, no-IO: parseUrlListFile reads a text file via fs; slugifyUrl is pure.

import { readFileSync } from "node:fs";

// Parse a newline-delimited URL list file. Comments (`#...`) and blank lines ignored.
// Handles CRLF. Throws if file cannot be read. Returns string[] of trimmed URLs.
export function parseUrlListFile(path) {
  const content = readFileSync(path, "utf8");
  const urls = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    urls.push(line);
  }
  return urls;
}

// Slugify a URL to a safe, deterministic filename stem (no extension).
// Shape: `<hostname>-<pathname-slug>` where:
//   - hostname lowercased; empty (e.g. file://) → "local"
//   - pathname split on "/", trailing ".html"/".htm" stripped from last segment,
//     joined with "-"; empty → "index"
//   - query string folded in as "-<slug>"
//   - any char outside [A-Za-z0-9._-] collapsed to "-"; consecutive "-" collapsed;
//     leading/trailing "-" stripped
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function slugifyUrl(urlStr) {
  const u = new URL(urlStr);
  const host = (u.hostname || "local").toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean).map(safeDecode);
  if (segs.length) {
    segs[segs.length - 1] = segs[segs.length - 1].replace(/\.html?$/i, "");
  }
  let pathPart = segs.join("-");
  if (u.search) {
    const q = safeDecode(u.search.replace(/^\?/, ""));
    pathPart = pathPart ? `${pathPart}-${q}` : q;
  }
  pathPart = pathPart
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!pathPart) pathPart = "index";
  return `${host}-${pathPart}`;
}

// Return true if `p` ends with an extension that signals "single-file output",
// meaning batch mode should refuse it (because we need a directory to write N files).
export function isSingleFileOutputPath(p) {
  return /\.(md|json)$/i.test(p);
}
