#!/usr/bin/env node
/*
 * Day-0 CDP-Inject Spike (US-004)
 *
 * Attempts to inject the unchanged `content-script.js` extraction logic via
 * Page.addScriptToEvaluateOnNewDocument with worldName (isolated world).
 * Verifies that payload parity can be achieved without modifying the
 * extension — which, if successful, unlocks the α path (ship v0.5 CDP-inject
 * CLI, defer shared-core refactor).
 *
 * Targets: fixture (baseline-compare), typeui.sh + github.com + stripe.com
 * (structural-shape check — live sites have Trusted Types / CSP variations).
 */

import { launch } from "chrome-launcher";
import { connect } from "puppeteer-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const FIXTURE = resolve(REPO_ROOT, "tests/fixtures/sample-dashboard.html");
const BASELINE = resolve(REPO_ROOT, "tests/fixtures/sample-dashboard.baseline.json");
const CS = resolve(REPO_ROOT, "content-script.js");
const CHECK = resolve(REPO_ROOT, "tests/check-contract.mjs");
const SPIKE_DIR = resolve(REPO_ROOT, "tests/fixtures/spike-output");
const REPORT = resolve(REPO_ROOT, "docs/spike-results.md");

mkdirSync(SPIKE_DIR, { recursive: true });

const TARGETS = [
  { name: "fixture", url: pathToFileURL(FIXTURE).href, mode: "baseline-compare" },
  { name: "typeui.sh", url: "https://www.typeui.sh", mode: "structural" },
  { name: "github.com", url: "https://github.com", mode: "structural-trusted-types" },
  { name: "stripe.com", url: "https://stripe.com", mode: "structural-csp" }
];

const TIMESTAMP_SENTINEL = "__TS__";
const TIMESTAMP_KEY_RE = /(sampledAt|timestamp|capturedAt|createdAt|updatedAt)$/i;

function patchContentScript(src) {
  const patched = src.replace(
    /chrome\.runtime\.onMessage\.addListener\([\s\S]*?\n\s*\}\);/m,
    "window.__typeuiExtract = extractStylesFromPage;"
  );
  if (patched === src) throw new Error("patch: could not locate chrome.runtime.onMessage block");
  return patched;
}

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

async function spikeOne(browser, target, patched) {
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

  const result = { target: target.name, url: target.url, mode: target.mode };
  const navStart = Date.now();
  try {
    await page.goto(target.url, { waitUntil: "networkidle2", timeout: 25000 });
    await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; }).catch(() => {});

    for (let i = 0; i < 80 && !ctxIds.length; i++) await new Promise(r => setTimeout(r, 100));
    result.navDurationMs = Date.now() - navStart;

    if (!ctxIds.length) {
      result.verdict = "FAIL";
      result.error = "isolated world context never created (possibly blocked by CSP/TT for addScriptToEvaluateOnNewDocument)";
      return result;
    }

    const evalRes = await cdp.send("Runtime.evaluate", {
      contextId: ctxIds[ctxIds.length - 1],
      expression:
        "(() => { if (typeof window.__typeuiExtract !== 'function') return { __err: 'no-extract-fn' };" +
        " try { return window.__typeuiExtract(); } catch (e) { return { __err: String(e && e.message || e) }; } })()",
      returnByValue: true,
      awaitPromise: true
    });

    const val = evalRes.result?.value;
    if (!val) {
      result.verdict = "FAIL";
      result.error = "evaluate returned no value";
      return result;
    }
    if (val.__err) {
      result.verdict = "FAIL";
      result.error = val.__err;
      return result;
    }

    const payload = normalizeTimestamps(val);
    const outPath = resolve(SPIKE_DIR, `${target.name}.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");

    if (target.mode === "baseline-compare") {
      const r = spawnSync("node", [CHECK, "--baseline", BASELINE, "--target", outPath], { encoding: "utf8" });
      if (r.status === 0) {
        result.verdict = "PASS";
        result.compare = "matches baseline";
      } else {
        result.verdict = "FAIL";
        result.compare = "baseline mismatch";
        result.diff = (r.stderr || "").split("\n").slice(0, 8).join(" | ");
      }
    } else {
      const ok = payload?.source && Array.isArray(payload.typography) && Array.isArray(payload.colors);
      result.verdict = ok ? "PASS" : "FAIL";
      result.compare = ok
        ? `typography=${payload.typography.length} colors=${payload.colors.length} sampled=${payload.sampledElements}/${payload.totalElements}`
        : "missing top-level keys";
    }
    return result;
  } catch (e) {
    result.navDurationMs = Date.now() - navStart;
    result.verdict = "FAIL";
    result.error = String(e?.message || e);
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
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
  const results = [];
  try {
    const res = await fetch(`http://localhost:${chrome.port}/json/version`);
    const { webSocketDebuggerUrl } = await res.json();
    browser = await connect({ browserWSEndpoint: webSocketDebuggerUrl });
    for (const t of TARGETS) {
      console.log(`[spike] ${t.name} (${t.url}) mode=${t.mode}...`);
      const r = await spikeOne(browser, t, patched);
      console.log(`  verdict=${r.verdict} ${r.error ? `err=${r.error}` : ""} ${r.compare || ""} [${r.navDurationMs ?? "-"}ms]`);
      results.push(r);
    }
  } finally {
    try { if (browser) await browser.disconnect(); } catch {}
    try { if (chrome) await chrome.kill(); } catch {}
  }

  const overall = results.every(r => r.verdict === "PASS") ? "PASS" : "FAIL";
  const verdictLine =
    overall === "PASS"
      ? "→ **α path** — ship v0.5 CDP-inject CLI (US-005a), defer shared-core refactor"
      : "→ **β path** — concat-core refactor (US-005b)";

  const report = [
    "# CDP-Inject Spike Results (US-004)",
    "",
    `Ran: \`${new Date().toISOString()}\``,
    `World: isolated (worldName="typeui-extractor"), via \`Page.addScriptToEvaluateOnNewDocument\``,
    "",
    `## Overall verdict: **${overall}** ${verdictLine}`,
    "",
    "## Per-target results",
    "",
    "| Target | URL | Mode | Verdict | Nav (ms) | Notes |",
    "|---|---|---|---|---|---|",
    ...results.map(r =>
      `| ${r.target} | ${r.url} | ${r.mode} | ${r.verdict} | ${r.navDurationMs ?? "-"} | ${String(r.compare || r.error || "").replace(/\|/g, "\\|").slice(0, 240)} |`
    ),
    "",
    "## Worlds / CSP / Trusted Types observations",
    "",
    "- **Isolated world**: `Page.addScriptToEvaluateOnNewDocument` with `worldName` creates a per-page isolated JS context, equivalent to an extension content-script's isolated world. This bypasses the page's Trusted Types CSP (`require-trusted-types-for 'script'`, enforced by GitHub) because the isolated world is not subject to page-level Trusted Types enforcement.",
    "- **CSP `script-src`**: does not apply to scripts injected via CDP `Page.addScriptToEvaluateOnNewDocument` — CDP-privileged injection is exempt from page CSP.",
    "- **Same-origin**: the isolated world shares the page's DOM (cross-world DOM access is allowed) but has a separate `window` proxy. `window.__typeuiExtract` lives in the isolated world's `window`; `document.querySelectorAll` still sees the page's DOM.",
    "- **Risks remaining**: shadow DOM (open shadow roots visible via `.shadowRoot`, closed ones not), cross-origin iframes (isolated worlds are per-frame; top-frame isolated world cannot extract from cross-origin child frames without per-frame injection).",
    "",
    "## Decision",
    "",
    overall === "PASS"
      ? "All 4 targets extracted via isolated-world CDP injection. **Proceed with α path**: ship v0.5 as a thin CLI that CDP-injects the unchanged `content-script.js`. Defer shared-core refactor (β) until a second consumer demands it."
      : "At least one target failed. **Proceed with β path**: concat-core refactor. Review per-target notes for root cause (CSP / Trusted Types / isolated-world creation failures).",
    "",
    "## Artifacts",
    "",
    "- Captured payloads: `tests/fixtures/spike-output/{fixture,typeui.sh,github.com,stripe.com}.json`",
    "- Baseline: `tests/fixtures/sample-dashboard.baseline.json`",
    "- Oracle: `tests/check-contract.mjs`"
  ].join("\n");

  writeFileSync(REPORT, report + "\n");
  console.log(`\nOverall: ${overall}. Report: ${REPORT}`);
  process.exit(overall === "PASS" ? 0 : 1);
}

main().catch(e => { console.error(e?.stack || e); process.exit(2); });
