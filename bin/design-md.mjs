#!/usr/bin/env node
/*
 * design-md CLI (v0.6 α path — CDP-inject, batch-capable)
 * Usage: design-md extract <url> [<url2> ...] [--input <file>]
 *                         [--mode design|skill] [--output <path>] [--verbose]
 *        design-md --version
 *
 * Schema stamping contract: JSON outputs (--dump-payload) are wrapped via writeWithSchema()
 * and carry __schemaVersion at the top level. Markdown outputs (.md) are for humans/agents
 * and intentionally do NOT embed __schemaVersion; consumers who need versioning should use
 * --dump-payload.
 *
 * Batch mode: >=2 URLs (positional and/or --input file) triggers batch mode:
 *   - --output <path> must NOT end in .md/.json (treated as directory, created if absent).
 *   - Absent --output: each doc streamed to stdout separated by "\n---\n" (md) or as a
 *     JSON array (--dump-payload).
 *   - Per-URL progress to stderr; failures are logged but do not abort remaining URLs.
 *   - Exit 0 iff all URLs succeeded; 1 if any failed; 2 for usage errors.
 */

import { launch } from "chrome-launcher";
import { connect } from "puppeteer-core";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { parseArgs } from "node:util";

import { normalizeExtractedStyles } from "../lib/normalize.mjs";
import { generateDesignMarkdown } from "../lib/generate-design-md.mjs";
import { generateSkillMarkdown } from "../lib/generate-skill-md.mjs";
import { generateCssVars } from "../lib/generate-css-vars.mjs";
import { writeWithSchema, SCHEMA_VERSION } from "../lib/schema.mjs";
import { patchContentScript, normalizeTimestamps } from "../lib/cdp-inject.mjs";
import { parseUrlListFile, slugifyUrl, isSingleFileOutputPath } from "../lib/batch.mjs";
import { parseWaitMs, resolveSelectorTimeout } from "../lib/wait-opts.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const CS = resolve(REPO_ROOT, "content-script.js");

const USAGE_TEXT =
  "Usage: design-md extract <url> [<url2> ...] [--input <file>]\n" +
  "                         [--mode design|skill] [--format md|json|css-vars]\n" +
  "                         [--wait <ms>] [--wait-selector <css>]\n" +
  "                         [--output <path>] [--verbose]\n" +
  "       design-md --version\n";

const VALID_FORMATS = ["md", "json", "css-vars"];
const EXT_BY_FORMAT = { md: ".md", json: ".json", "css-vars": ".css" };

function usage(exitCode = 0) {
  process.stderr.write(USAGE_TEXT);
  process.exit(exitCode);
}

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      mode: { type: "string", default: "design" },
      format: { type: "string", default: "md" },
      output: { type: "string", short: "o" },
      input: { type: "string" },
      wait: { type: "string" },
      "wait-selector": { type: "string" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean" },
      version: { type: "boolean" },
      "dump-payload": { type: "boolean", default: false }
    },
    allowPositionals: true
  });
} catch (e) {
  process.stderr.write(`design-md: ${e.message}\n`);
  process.stderr.write(USAGE_TEXT);
  process.exit(2);
}

const { values, positionals } = parsed;

if (values.version) {
  const pj = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
  process.stdout.write(`${pj.version} (schema ${SCHEMA_VERSION})\n`);
  process.exit(0);
}
if (values.help) usage(0);
if (positionals[0] !== "extract") usage(2);

const positionalUrls = positionals.slice(1);
let fileUrls = [];
if (values.input) {
  try {
    fileUrls = parseUrlListFile(values.input);
  } catch (e) {
    process.stderr.write(`design-md: --input ${values.input}: ${e.message}\n`);
    process.exit(2);
  }
}
const urls = [...positionalUrls, ...fileUrls];
if (urls.length === 0) usage(2);

if (!["design", "skill"].includes(values.mode)) {
  process.stderr.write(`design-md: --mode must be 'design' or 'skill', got '${values.mode}'\n`);
  process.exit(2);
}

if (!VALID_FORMATS.includes(values.format)) {
  process.stderr.write(
    `design-md: --format must be one of ${VALID_FORMATS.join("|")}, got '${values.format}'\n`
  );
  process.exit(2);
}

// Mutex: --format and --dump-payload are mutually exclusive, except that the default
// (--format md) is treated as "unset" for compatibility — --dump-payload alone still works.
const formatExplicit = process.argv.slice(2).some(a => a === "--format" || a.startsWith("--format="));
if (values["dump-payload"] && formatExplicit) {
  process.stderr.write("design-md: --format and --dump-payload are mutually exclusive\n");
  process.exit(2);
}
// Deprecated alias: --dump-payload → --format json
if (values["dump-payload"]) {
  process.stderr.write("design-md: --dump-payload is deprecated, use --format json\n");
  values.format = "json";
}

const waitParse = parseWaitMs(values.wait);
if (!waitParse.ok) {
  process.stderr.write(`design-md: --wait ${waitParse.reason}, got '${values.wait}'\n`);
  process.exit(2);
}
const WAIT_MS = waitParse.value;
const WAIT_SELECTOR = values["wait-selector"] || null;
const WAIT_SELECTOR_TIMEOUT = resolveSelectorTimeout(process.env.DESIGN_MD_SELECTOR_TIMEOUT);

const isBatch = urls.length >= 2;

if (isBatch && values.output && values.output !== "-" && isSingleFileOutputPath(values.output)) {
  process.stderr.write(
    `design-md: batch mode requires --output to be a directory, got '${values.output}'\n`
  );
  process.exit(2);
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
    if (WAIT_SELECTOR) {
      const tSel = Date.now();
      try {
        await page.waitForSelector(WAIT_SELECTOR, { timeout: WAIT_SELECTOR_TIMEOUT });
        if (verbose) process.stderr.write(`[design-md] wait-selector matched in ${Date.now() - tSel}ms\n`);
      } catch {
        process.stderr.write(`design-md: --wait-selector timeout (${WAIT_SELECTOR_TIMEOUT}ms), proceeding anyway\n`);
      }
    }
    if (WAIT_MS > 0) {
      if (verbose) process.stderr.write(`[design-md] extra-wait ${WAIT_MS}ms\n`);
      await new Promise(r => setTimeout(r, WAIT_MS));
    }
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
    fontFallbackCount
  };
}

function renderMarkdown(payload, targetUrl) {
  const normalized = normalizeExtractedStyles(payload);
  const metadata = {
    systemName: (payload.source?.title || "Design System").slice(0, 80),
    brand: (() => { try { return new URL(payload.source?.url || targetUrl).hostname; } catch { return ""; } })()
  };
  return values.mode === "skill"
    ? generateSkillMarkdown({ normalized, metadata })
    : generateDesignMarkdown({ normalized, metadata });
}

function renderJson(payload) {
  const normalizedPayload = normalizeTimestamps(payload);
  return JSON.stringify(writeWithSchema(normalizedPayload), null, 2) + "\n";
}

function renderCssVars(payload) {
  const normalized = normalizeExtractedStyles(payload);
  return generateCssVars({ normalized, payload });
}

function renderForFormat(payload, targetUrl) {
  switch (values.format) {
    case "json": return renderJson(payload);
    case "css-vars": return renderCssVars(payload);
    case "md":
    default: return renderMarkdown(payload, targetUrl);
  }
}

async function processUrl(target) {
  const payload = await extractViaCdp(target, values.verbose);
  const diagnostics = computeDiagnostics(payload);
  const content = renderForFormat(payload, target);
  return { payload, diagnostics, content };
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  const st = statSync(dir);
  if (!st.isDirectory()) {
    throw new Error(`${dir} exists but is not a directory`);
  }
}

async function mainSingle() {
  const target = urls[0];
  const { payload, diagnostics, content } = await processUrl(target);

  if (values.output && values.output !== "-") {
    writeFileSync(values.output, content);
    if (values.format === "json") {
      process.stderr.write(`design-md: wrote raw payload to ${values.output}\n`);
    } else {
      process.stderr.write(`design-md: wrote ${values.output} (${content.length} bytes)\n`);
    }
  } else {
    process.stdout.write(content);
  }

  if (values.verbose) {
    if (values.format === "json") {
      process.stderr.write(`[design-md] diagnostics=${JSON.stringify(diagnostics)}\n`);
    } else {
      const stamped = writeWithSchema({
        mode: values.mode,
        format: values.format,
        sourceUrl: payload.source?.url || target,
        title: payload.source?.title || "",
        diagnostics
      });
      process.stderr.write("[design-md] " + JSON.stringify(stamped) + "\n");
    }
  }
}

async function mainBatch() {
  const total = urls.length;
  const results = [];
  const failures = [];

  const dir = values.output && values.output !== "-" ? values.output : null;
  if (dir) ensureDir(dir);

  for (let i = 0; i < total; i++) {
    const target = urls[i];
    const t0 = Date.now();
    process.stderr.write(`[${i + 1}/${total}] extracting ${target} ...\n`);
    try {
      const { payload, diagnostics, content } = await processUrl(target);
      const ext = EXT_BY_FORMAT[values.format];
      if (dir) {
        const name = slugifyUrl(target) + ext;
        const outPath = join(dir, name);
        writeFileSync(outPath, content);
        process.stderr.write(`[${i + 1}/${total}] done in ${Date.now() - t0}ms → ${outPath}\n`);
      } else {
        results.push({ target, content, payload });
        process.stderr.write(`[${i + 1}/${total}] done in ${Date.now() - t0}ms\n`);
      }
      if (values.verbose) {
        process.stderr.write(`[design-md] [${i + 1}/${total}] diagnostics=${JSON.stringify(diagnostics)}\n`);
      }
    } catch (err) {
      failures.push({ target, err });
      process.stderr.write(`[${i + 1}/${total}] FAILED: ${err?.message || err}\n`);
    }
  }

  if (!dir && results.length) {
    if (values.format === "json") {
      const arr = results.map(r => {
        const normalized = normalizeTimestamps(r.payload);
        return writeWithSchema(normalized);
      });
      process.stdout.write(JSON.stringify(arr, null, 2) + "\n");
    } else {
      process.stdout.write(results.map(r => r.content).join("\n---\n"));
    }
  }

  if (failures.length) {
    process.stderr.write(`design-md: ${failures.length}/${total} url(s) failed\n`);
    process.exit(1);
  }
}

async function main() {
  if (isBatch) {
    await mainBatch();
  } else {
    await mainSingle();
  }
}

main().catch(err => {
  process.stderr.write(`design-md: ${err?.stack || err}\n`);
  process.exit(1);
});
