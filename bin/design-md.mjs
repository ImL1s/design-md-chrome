#!/usr/bin/env node
/*
 * design-md CLI (v0.5 α path — CDP-inject)
 * Usage: design-md extract <url> [--mode design|skill] [--output <path>] [--verbose]
 *        design-md --version
 */

import { launch } from "chrome-launcher";
import { connect } from "puppeteer-core";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { normalizeExtractedStyles } from "../lib/normalize.mjs";
import { generateDesignMarkdown } from "../lib/generate-design-md.mjs";
import { generateSkillMarkdown } from "../lib/generate-skill-md.mjs";
import { writeWithSchema, SCHEMA_VERSION } from "../lib/schema.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const CS = resolve(REPO_ROOT, "content-script.js");

function usage(exitCode = 0) {
  process.stderr.write(
    "Usage: design-md extract <url> [--mode design|skill] [--output <path>] [--verbose]\n" +
    "       design-md --version\n"
  );
  process.exit(exitCode);
}

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      mode: { type: "string", default: "design" },
      output: { type: "string", short: "o" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean" },
      version: { type: "boolean" },
      "dump-payload": { type: "boolean", default: false }
    },
    allowPositionals: true
  });
} catch (e) {
  process.stderr.write(`design-md: ${e.message}\n`);
  usage(2);
}

const { values, positionals } = parsed;

if (values.version) {
  const pj = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
  process.stdout.write(`${pj.version} (schema ${SCHEMA_VERSION})\n`);
  process.exit(0);
}
if (values.help) usage(0);
if (positionals[0] !== "extract" || !positionals[1]) usage(2);

const url = positionals[1];
if (!["design", "skill"].includes(values.mode)) {
  process.stderr.write(`design-md: --mode must be 'design' or 'skill', got '${values.mode}'\n`);
  process.exit(2);
}

function patchContentScript(src) {
  const patched = src.replace(
    /chrome\.runtime\.onMessage\.addListener\([\s\S]*?\n\s*\}\);/m,
    "window.__typeuiExtract = extractStylesFromPage;"
  );
  if (patched === src) {
    throw new Error("content-script.js structure changed — cannot locate chrome.runtime.onMessage block");
  }
  return patched;
}

async function extractViaCdp(target, verbose) {
  const patched = patchContentScript(readFileSync(CS, "utf8"));
  const chrome = await launch({
    chromeFlags: [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-sandbox",
      "--font-render-hinting=none"
    ]
  });
  let browser;
  const t0 = Date.now();
  try {
    const res = await fetch(`http://localhost:${chrome.port}/json/version`);
    const { webSocketDebuggerUrl } = await res.json();
    browser = await connect({ browserWSEndpoint: webSocketDebuggerUrl });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const cdp = await page.target().createCDPSession();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    const ctxIds = [];
    cdp.on("Runtime.executionContextCreated", ({ context }) => {
      if (context.name === "typeui-extractor") ctxIds.push(context.id);
    });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: patched,
      worldName: "typeui-extractor"
    });
    await page.goto(target, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; }).catch(() => {});
    for (let i = 0; i < 80 && !ctxIds.length; i++) await new Promise(r => setTimeout(r, 100));
    if (!ctxIds.length) {
      throw new Error("isolated world context never created (site may block CDP injection)");
    }
    const evalRes = await cdp.send("Runtime.evaluate", {
      contextId: ctxIds[ctxIds.length - 1],
      expression:
        "(() => { if (typeof window.__typeuiExtract !== 'function') throw new Error('no extract fn');" +
        " return window.__typeuiExtract(); })()",
      returnByValue: true,
      awaitPromise: true
    });
    if (evalRes.exceptionDetails) {
      throw new Error(evalRes.exceptionDetails.exception?.description || "extraction threw");
    }
    const payload = evalRes.result?.value;
    if (!payload) throw new Error("extraction returned no payload");
    if (verbose) process.stderr.write(`[design-md] extract took ${Date.now() - t0}ms\n`);
    return payload;
  } finally {
    try { if (browser) await browser.disconnect(); } catch {}
    try { if (chrome) await chrome.kill(); } catch {}
  }
}

function computeDiagnostics(payload) {
  const typography = payload.typography || [];
  const fontFallbackCount = typography.filter(t =>
    typeof t.fontFamily === "string" &&
    /system-ui|-apple-system|sans-serif|serif|monospace/i.test(t.fontFamily)
  ).length;
  return {
    sampledCount: payload.sampledElements ?? typography.length,
    visibleCount: payload.sampledElements ?? typography.length,
    fontFallbackCount
  };
}

const TIMESTAMP_SENTINEL = "__TS__";
const TIMESTAMP_KEY_RE = /(sampledAt|timestamp|capturedAt|createdAt|updatedAt)$/i;
function normalizeTimestamps(obj) {
  if (Array.isArray(obj)) return obj.map(normalizeTimestamps);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = TIMESTAMP_KEY_RE.test(k) ? TIMESTAMP_SENTINEL : normalizeTimestamps(v);
    }
    return out;
  }
  return obj;
}

async function main() {
  const payload = await extractViaCdp(url, values.verbose);
  const diagnostics = computeDiagnostics(payload);

  if (values["dump-payload"]) {
    const normalizedPayload = normalizeTimestamps(payload);
    const out = JSON.stringify(normalizedPayload, null, 2) + "\n";
    if (values.output && values.output !== "-") {
      writeFileSync(values.output, out);
      process.stderr.write(`design-md: wrote raw payload to ${values.output}\n`);
    } else {
      process.stdout.write(out);
    }
    if (values.verbose) process.stderr.write(`[design-md] diagnostics=${JSON.stringify(diagnostics)}\n`);
    return;
  }

  const normalized = normalizeExtractedStyles(payload);
  const metadata = {
    systemName: (payload.source?.title || "Design System").slice(0, 80),
    brand: (() => { try { return new URL(payload.source?.url || url).hostname; } catch { return ""; } })()
  };
  const md = values.mode === "skill"
    ? generateSkillMarkdown({ normalized, metadata })
    : generateDesignMarkdown({ normalized, metadata });

  const stamped = writeWithSchema({
    mode: values.mode,
    sourceUrl: payload.source?.url || url,
    title: payload.source?.title || "",
    diagnostics
  });

  if (values.output && values.output !== "-") {
    writeFileSync(values.output, md);
    process.stderr.write(`design-md: wrote ${values.output} (${md.length} bytes)\n`);
  } else {
    process.stdout.write(md);
  }

  if (values.verbose) {
    process.stderr.write("[design-md] " + JSON.stringify(stamped) + "\n");
  }
}

main().catch(err => {
  process.stderr.write(`design-md: ${err?.stack || err}\n`);
  process.exit(1);
});
