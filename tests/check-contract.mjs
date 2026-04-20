#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const TIMESTAMP_SENTINEL = "__TS__";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const TIMESTAMP_KEY_RE = /(sampledAt|timestamp|capturedAt|createdAt|updatedAt)$/i;

export function normalizeFontFamily(s) {
  if (typeof s !== "string") return s;
  return s.trim().replace(/["']/g, "").toLowerCase()
    .split(",").map(t => t.trim()).filter(Boolean).join(", ");
}

export function normalizeColor(s) {
  if (typeof s !== "string") return s;
  const t = s.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  const short = t.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const rgb = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/);
  if (rgb) {
    const h = n => parseInt(n, 10).toString(16).padStart(2, "0");
    return `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`;
  }
  return t;
}

export function isColorValue(v) {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return /^#[0-9a-fA-F]{3,6}$/.test(t) || /^rgba?\(/i.test(t);
}

export function parsePx(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? parseFloat(m[1]) : null;
}

export function normalizeTimestamp(v, keyHint) {
  if (typeof v !== "string") return v;
  if (ISO_DATE_RE.test(v)) return TIMESTAMP_SENTINEL;
  if (keyHint && TIMESTAMP_KEY_RE.test(keyHint)) return TIMESTAMP_SENTINEL;
  return v;
}

function compareNode(a, b, path, errors, keyHint) {
  a = normalizeTimestamp(a, keyHint);
  b = normalizeTimestamp(b, keyHint);

  if (a === undefined || b === undefined) {
    if (a !== b)
      errors.push(`${path || "(root)"}: field present on one side only (baseline=${a === undefined ? "missing" : "present"}, target=${b === undefined ? "missing" : "present"})`);
    return;
  }
  if (a === null || b === null) {
    if (a !== b) errors.push(`${path || "(root)"}: null mismatch (${a} vs ${b})`);
    return;
  }
  if (typeof a !== typeof b) {
    errors.push(`${path || "(root)"}: type mismatch (${typeof a} vs ${typeof b})`);
    return;
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      errors.push(`${path}: array length mismatch (${a.length} vs ${b?.length})`);
      return;
    }
    a.forEach((v, i) => compareNode(v, b[i], `${path}[${i}]`, errors));
    return;
  }
  if (typeof a === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      compareNode(a[k], b[k], path ? `${path}.${k}` : k, errors, k);
    }
    return;
  }
  if (typeof a === "string") {
    if (/fontfamily/i.test(path)) {
      if (normalizeFontFamily(a) !== normalizeFontFamily(b))
        errors.push(`${path}: fontFamily mismatch ("${a}" vs "${b}")`);
      return;
    }
    if (isColorValue(a) || isColorValue(b)) {
      if (normalizeColor(a) !== normalizeColor(b))
        errors.push(`${path}: color mismatch (${a} vs ${b})`);
      return;
    }
    const pa = parsePx(a), pb = parsePx(b);
    if (pa !== null && pb !== null) {
      if (Math.abs(pa - pb) > 1)
        errors.push(`${path}: px mismatch beyond ±1 (${a} vs ${b})`);
      return;
    }
    if (a !== b) errors.push(`${path}: string mismatch ("${a}" vs "${b}")`);
    return;
  }
  if (typeof a === "number") {
    if (a === 0 && b === 0) return;
    const denom = Math.abs(a) || 1;
    if (Math.abs(a - b) / denom > 0.02)
      errors.push(`${path}: number outside ±2% (${a} vs ${b})`);
    return;
  }
  if (a !== b) errors.push(`${path}: primitive mismatch (${a} vs ${b})`);
}

function collectTopColors(obj, n) {
  const out = [];
  const seen = new Set();
  const push = v => {
    if (!isColorValue(v)) return;
    const c = normalizeColor(v);
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  };
  if (Array.isArray(obj?.tokens?.colors)) obj.tokens.colors.forEach(push);
  if (out.length < n && Array.isArray(obj?.colors)) {
    for (const row of obj.colors) {
      if (out.length >= n) break;
      if (row && typeof row === "object") Object.values(row).forEach(push);
    }
  }
  return out.slice(0, n);
}

function collectTopFontSizes(obj, n) {
  const out = [];
  const seen = new Set();
  const push = v => {
    const px = typeof v === "string" ? parsePx(v) : (typeof v === "number" ? v : null);
    if (px === null) return;
    if (!seen.has(px)) { seen.add(px); out.push(px); }
  };
  if (Array.isArray(obj?.tokens?.fontSizes)) obj.tokens.fontSizes.forEach(push);
  if (out.length < n && Array.isArray(obj?.typography)) {
    for (const row of obj.typography) {
      if (out.length >= n) break;
      if (row?.fontSize) push(row.fontSize);
    }
  }
  return out.slice(0, n);
}

function collectTopFontFamilies(obj, n) {
  const out = [];
  const seen = new Set();
  const push = v => {
    if (typeof v !== "string") return;
    const f = normalizeFontFamily(v);
    if (!f) return;
    if (!seen.has(f)) { seen.add(f); out.push(f); }
  };
  if (Array.isArray(obj?.tokens?.fontFamilies)) obj.tokens.fontFamilies.forEach(push);
  if (out.length < n && Array.isArray(obj?.typography)) {
    for (const row of obj.typography) {
      if (out.length >= n) break;
      if (row?.fontFamily) push(row.fontFamily);
    }
  }
  return out.slice(0, n);
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function computeContentHashes(obj) {
  return {
    top5Colors: sha256(collectTopColors(obj, 5)),
    top3FontSizes: sha256(collectTopFontSizes(obj, 3)),
    top3FontFamilies: sha256(collectTopFontFamilies(obj, 3))
  };
}

function stripEnvelope(payload) {
  // `__schemaVersion` is an envelope field stamped by writeWithSchema() on
  // persisted CLI outputs; it is NOT part of the structural contract, so strip
  // it before diff so a stamped target can compare cleanly against an
  // unstamped baseline (or vice versa).
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const { __schemaVersion: _v, ...rest } = payload;
    return rest;
  }
  return payload;
}

export function checkContract(baseline, target) {
  const cleanBaseline = stripEnvelope(baseline);
  const cleanTarget = stripEnvelope(target);
  const errors = [];
  compareNode(cleanBaseline, cleanTarget, "", errors);
  const hb = computeContentHashes(cleanBaseline);
  const ht = computeContentHashes(cleanTarget);
  for (const key of ["top5Colors", "top3FontSizes", "top3FontFamilies"]) {
    if (hb[key] !== ht[key])
      errors.push(`[hash] ${key} drift: ${hb[key].slice(0, 12)} vs ${ht[key].slice(0, 12)}`);
  }
  return { ok: errors.length === 0, errors };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        baseline: { type: "string" },
        target: { type: "string" }
      }
    }));
  } catch (e) {
    console.error(`check-contract: ${e.message}`);
    process.exit(2);
  }
  if (!values.baseline || !values.target) {
    console.error("Usage: check-contract.mjs --baseline <path> --target <path>");
    process.exit(2);
  }
  let baseline, target;
  try {
    baseline = JSON.parse(readFileSync(values.baseline, "utf8"));
  } catch (e) {
    console.error(`check-contract: cannot parse baseline: ${e.message}`);
    process.exit(2);
  }
  try {
    target = JSON.parse(readFileSync(values.target, "utf8"));
  } catch (e) {
    console.error(`check-contract: cannot parse target: ${e.message}`);
    process.exit(2);
  }
  const { ok, errors } = checkContract(baseline, target);
  if (!ok) {
    console.error("CONTRACT FAIL:");
    errors.forEach(e => console.error("  " + e));
    process.exit(1);
  }
  console.log("CONTRACT PASS");
  process.exit(0);
}
