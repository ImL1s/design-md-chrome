#!/usr/bin/env node
/*
 * Capture an extension-equivalent baseline payload from the fixture using real
 * Chromium via chrome-launcher + puppeteer-core. The baseline is the oracle for
 * Day-0 CDP-inject spike (US-004) and future regression tests.
 *
 * The extension's `content-script.js` is an IIFE whose only side effect (besides
 * the idempotency sentinel) is registering a `chrome.runtime.onMessage` listener.
 * We patch that listener out and attach `extractStylesFromPage` to `window`,
 * then invoke it via page.evaluate. The DOM-extraction body is untouched — this
 * keeps `content-script.js` as single source of truth.
 */

import { launch } from "chrome-launcher";
import { connect } from "puppeteer-core";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const FIXTURE = resolve(REPO_ROOT, "tests/fixtures/sample-dashboard.html");
const OUT = resolve(REPO_ROOT, "tests/fixtures/sample-dashboard.baseline.json");
const CS = resolve(REPO_ROOT, "content-script.js");
const CHECK = resolve(REPO_ROOT, "tests/check-contract.mjs");

const TIMESTAMP_SENTINEL = "__TS__";
const TIMESTAMP_KEY_RE = /(sampledAt|timestamp|capturedAt|createdAt|updatedAt)$/i;

function patchContentScript(src) {
  const patched = src.replace(
    /chrome\.runtime\.onMessage\.addListener\([\s\S]*?\n\s*\}\);/m,
    "window.__typeuiExtract = extractStylesFromPage;"
  );
  if (patched === src) {
    throw new Error(
      "patchContentScript: could not locate chrome.runtime.onMessage.addListener block — " +
      "content-script.js structure may have changed."
    );
  }
  return patched;
}

function normalizeTimestamps(obj) {
  if (Array.isArray(obj)) return obj.map(normalizeTimestamps);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (TIMESTAMP_KEY_RE.test(k)) out[k] = TIMESTAMP_SENTINEL;
      else out[k] = normalizeTimestamps(v);
    }
    return out;
  }
  return obj;
}

async function main() {
  if (!existsSync(FIXTURE)) {
    throw new Error(`Fixture missing: ${FIXTURE}`);
  }
  if (!existsSync(CS)) {
    throw new Error(`content-script.js missing: ${CS}`);
  }
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
  try {
    const res = await fetch(`http://localhost:${chrome.port}/json/version`);
    const { webSocketDebuggerUrl } = await res.json();
    browser = await connect({ browserWSEndpoint: webSocketDebuggerUrl });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(pathToFileURL(FIXTURE).href, { waitUntil: "networkidle0" });
    await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });

    await page.evaluate(patched);
    const payload = await page.evaluate(() =>
      typeof window.__typeuiExtract === "function" ? window.__typeuiExtract() : null
    );
    if (!payload) {
      throw new Error("extraction returned no payload — window.__typeuiExtract missing");
    }

    const normalized = normalizeTimestamps(payload);
    writeFileSync(OUT, JSON.stringify(normalized, null, 2) + "\n");
    console.log(
      `Baseline written: ${OUT}\n` +
      `  sampled=${normalized.sampledElements}/${normalized.totalElements}, ` +
      `typography=${normalized.typography.length}, colors=${normalized.colors.length}`
    );

    const r = spawnSync("node", [CHECK, "--baseline", OUT, "--target", OUT], { stdio: "inherit" });
    if (r.status !== 0) {
      throw new Error("self-check failed: baseline does not match itself via check-contract.mjs");
    }
    console.log("Self-check: CONTRACT PASS");
  } finally {
    if (browser) await browser.disconnect();
    if (chrome) await chrome.kill();
  }
}

main().catch(err => {
  console.error(err?.stack || err);
  process.exit(1);
});
