// Batch-mode helpers for design-md CLI v0.6 (US-001).
// Pure, no-IO: parseUrlListFile reads a text file via fs; slugifyUrl, truncateSlug,
// and dedupeSlug are pure.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Leave headroom below the 255-byte NAME_MAX on ext4/APFS/NTFS after the CLI
// appends an extension (.md/.json/.css). 200 bytes covers all current extensions.
const SLUG_MAX_LEN = 200;

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

// If a slug would exceed SLUG_MAX_LEN bytes, truncate and append a short hash of
// the full original slug so the result stays deterministic and distinguishable
// across different overflowing inputs. The 9-byte tail is "-" + 8 hex chars.
export function truncateSlug(slug, maxLen = SLUG_MAX_LEN) {
  if (slug.length <= maxLen) return slug;
  const hash = createHash("sha256").update(slug).digest("hex").slice(0, 8);
  return slug.slice(0, maxLen - 9) + "-" + hash;
}

// Deterministic collision-safe slug: if `slug` already exists in `usedSet`, append
// "-2", "-3", ... until unused. Mutates usedSet by adding the returned slug.
export function dedupeSlug(slug, usedSet) {
  if (!usedSet.has(slug)) {
    usedSet.add(slug);
    return slug;
  }
  let i = 2;
  while (usedSet.has(`${slug}-${i}`)) i++;
  const unique = `${slug}-${i}`;
  usedSet.add(unique);
  return unique;
}

// Return true if `p` ends with an extension that signals "single-file output",
// meaning batch mode should refuse it (because we need a directory to write N files).
export function isSingleFileOutputPath(p) {
  return /\.(md|json|css)$/i.test(p);
}
