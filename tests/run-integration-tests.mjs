#!/usr/bin/env node
/*
 * Integration tests (US-005a / US-009): CLI end-to-end + structural-contract
 * parity against the committed baseline. Requires puppeteer-core + chrome-launcher
 * + a real Chrome on host. Run via: node tests/run-integration-tests.mjs
 *
 * CI budget: must complete <= 60 seconds on a warm Chrome.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const CLI = resolve(REPO_ROOT, "bin/design-md.mjs");
const FIXTURE = resolve(REPO_ROOT, "tests/fixtures/sample-dashboard.html");
const FIXTURE_URL = pathToFileURL(FIXTURE).href;
const BASELINE = resolve(REPO_ROOT, "tests/fixtures/sample-dashboard.baseline.json");
const CHECK = resolve(REPO_ROOT, "tests/check-contract.mjs");

const PAYLOAD_OUT = resolve(REPO_ROOT, "tests/fixtures/integration-payload.json");
const DESIGN_MD_OUT = resolve(REPO_ROOT, "tests/fixtures/integration-design.md");
const SKILL_MD_OUT = resolve(REPO_ROOT, "tests/fixtures/integration-skill.md");

function cleanup() {
  for (const f of [PAYLOAD_OUT, DESIGN_MD_OUT, SKILL_MD_OUT]) {
    if (existsSync(f)) unlinkSync(f);
  }
}

function run(args, timeout = 60000) {
  return spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

try {
  cleanup();

  // 1. CLI --version
  {
    const r = run(["--version"]);
    assert.equal(r.status, 0, `--version exit 0, got ${r.status}`);
    assert.match(r.stdout, /^\d+\.\d+\.\d+ \(schema \d+\)\n$/, `--version format, got: ${r.stdout}`);
  }

  // 2. CLI usage exits 2 with no args
  {
    const r = run([]);
    assert.equal(r.status, 2, "no args should exit 2");
    assert.match(r.stderr, /Usage:/, "usage shown");
  }

  // 3. CLI rejects bad --mode
  {
    const r = run(["extract", FIXTURE_URL, "--mode", "nope"]);
    assert.equal(r.status, 2, "bad mode exits 2");
    assert.match(r.stderr, /--mode must be/, "mode error shown");
  }

  // 4. CLI extract in design mode produces valid DESIGN.md
  {
    const r = run(["extract", FIXTURE_URL, "--mode", "design", "-o", DESIGN_MD_OUT]);
    assert.equal(r.status, 0, `design mode exit 0, stderr: ${r.stderr}`);
    const md = readFileSync(DESIGN_MD_OUT, "utf8");
    assert.ok(md.includes("## Mission"), "DESIGN.md has Mission");
    assert.ok(md.includes("## Style Foundations"), "DESIGN.md has Style Foundations");
    assert.ok(md.includes("WCAG 2.2 AA"), "DESIGN.md has WCAG");
    assert.ok(md.length > 500, "DESIGN.md non-trivial size");
  }

  // 5. CLI extract in skill mode produces managed block
  {
    const r = run(["extract", FIXTURE_URL, "--mode", "skill", "-o", SKILL_MD_OUT]);
    assert.equal(r.status, 0, `skill mode exit 0, stderr: ${r.stderr}`);
    const md = readFileSync(SKILL_MD_OUT, "utf8");
    assert.ok(md.startsWith("---"), "SKILL.md starts with frontmatter");
    assert.ok(md.includes("TYPEUI_SH_MANAGED_START"), "SKILL.md has managed marker");
    assert.ok(md.includes("TYPEUI_SH_MANAGED_END"), "SKILL.md has managed end marker");
  }

  // 6. CLI --dump-payload + check-contract against baseline
  {
    const r = run(["extract", FIXTURE_URL, "--dump-payload", "-o", PAYLOAD_OUT]);
    assert.equal(r.status, 0, `--dump-payload exit 0, stderr: ${r.stderr}`);
    const check = spawnSync("node", [CHECK, "--baseline", BASELINE, "--target", PAYLOAD_OUT], { encoding: "utf8" });
    assert.equal(check.status, 0,
      `CLI payload vs baseline: check-contract exit 0 expected, got ${check.status}\n${check.stdout}\n${check.stderr}`
    );
  }

  // 7. --verbose emits diagnostics to stderr
  {
    const r = run(["extract", FIXTURE_URL, "--mode", "design", "-o", DESIGN_MD_OUT, "--verbose"]);
    assert.equal(r.status, 0, `verbose exit 0, stderr: ${r.stderr}`);
    assert.match(r.stderr, /__schemaVersion":1/, "verbose emits __schemaVersion");
    assert.match(r.stderr, /sampledCount/, "verbose emits sampledCount");
    assert.match(r.stderr, /fontFallbackCount/, "verbose emits fontFallbackCount");
  }

  console.log("Integration tests passed.");
} finally {
  cleanup();
}
