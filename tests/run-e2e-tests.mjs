#!/usr/bin/env node
/*
 * End-to-end tests (US-009). Offline mandatory; online smoke gated by E2E_ONLINE=1.
 * Offline portion must complete <= 3 minutes on CI (enforced by assert).
 *
 * Run: node tests/run-e2e-tests.mjs
 *      E2E_ONLINE=1 node tests/run-e2e-tests.mjs   # also hit typeui.sh
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), "..");
const CLI = resolve(REPO, "bin/design-md.mjs");
const CHECK = resolve(REPO, "tests/check-contract.mjs");
const BASELINE = resolve(REPO, "tests/fixtures/sample-dashboard.baseline.json");
const FIXTURE_URL = pathToFileURL(resolve(REPO, "tests/fixtures/sample-dashboard.html")).href;

const CI_BUDGET_MS = 3 * 60 * 1000;

const tmpPayload = resolve(REPO, "tests/fixtures/integration-e2e-payload.json");
const tmpSkill = resolve(REPO, "tests/fixtures/integration-e2e-skill.md");
const tmpDesign = resolve(REPO, "tests/fixtures/integration-e2e-design.md");
const tmpOnline = resolve(REPO, "tests/fixtures/integration-e2e-online.md");
const cleanupFiles = [tmpPayload, tmpSkill, tmpDesign, tmpOnline];

function cleanup() {
  for (const f of cleanupFiles) if (existsSync(f)) unlinkSync(f);
}

function runCli(args, timeout = 60000) {
  return spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

const startOffline = Date.now();
try {
  cleanup();

  // 1. Extension-equivalent payload via CLI --dump-payload matches baseline
  console.log("[e2e offline] CLI --dump-payload on fixture");
  {
    const r = runCli(["extract", FIXTURE_URL, "--dump-payload", "-o", tmpPayload]);
    assert.equal(r.status, 0, `dump-payload exit 0, stderr: ${r.stderr}`);
    const c = spawnSync("node", [CHECK, "--baseline", BASELINE, "--target", tmpPayload], { encoding: "utf8" });
    assert.equal(c.status, 0,
      `check-contract must exit 0 (CLI payload vs baseline), got ${c.status}\n${c.stdout}\n${c.stderr}`);
  }

  // 2. Skill-mode output has frontmatter + managed block + required sections
  console.log("[e2e offline] CLI --mode skill on fixture");
  {
    const r = runCli(["extract", FIXTURE_URL, "--mode", "skill", "-o", tmpSkill]);
    assert.equal(r.status, 0, `skill mode exit 0, stderr: ${r.stderr}`);
    const md = readFileSync(tmpSkill, "utf8");
    assert.ok(md.startsWith("---\n"), "SKILL.md starts with frontmatter");
    assert.match(md, /TYPEUI_SH_MANAGED_START/, "managed start marker");
    assert.match(md, /TYPEUI_SH_MANAGED_END/, "managed end marker");
    assert.match(md, /^## Mission$/m, "Mission section");
    assert.match(md, /^## Style Foundations$/m, "Style Foundations section");
    assert.match(md, /WCAG 2\.2 AA/, "WCAG target");
  }

  // 3. Design-mode output has required sections
  console.log("[e2e offline] CLI --mode design on fixture");
  {
    const r = runCli(["extract", FIXTURE_URL, "--mode", "design", "-o", tmpDesign]);
    assert.equal(r.status, 0, `design mode exit 0, stderr: ${r.stderr}`);
    const md = readFileSync(tmpDesign, "utf8");
    assert.match(md, /^## Mission$/m, "Mission");
    assert.match(md, /^## Rules: Do$/m, "Rules: Do");
    assert.match(md, /^## Rules: Don't$/m, "Rules: Don't");
    assert.match(md, /^## Quality Gates$/m, "Quality Gates");
  }

  // 4. Wall-clock within CI budget
  const offlineMs = Date.now() - startOffline;
  console.log(`[e2e offline] wall-clock: ${offlineMs} ms (budget ${CI_BUDGET_MS} ms)`);
  assert.ok(offlineMs <= CI_BUDGET_MS,
    `offline e2e exceeded CI budget: ${offlineMs} ms > ${CI_BUDGET_MS} ms`);

  // 5. Online smoke (opt-in): structural shape on typeui.sh — no value assertion
  if (process.env.E2E_ONLINE === "1") {
    console.log("[e2e online] CLI on https://www.typeui.sh (structural shape only)");
    const onlineStart = Date.now();
    const r = runCli(["extract", "https://www.typeui.sh", "--mode", "skill", "-o", tmpOnline], 90000);
    assert.equal(r.status, 0, `online extract exit 0, stderr: ${r.stderr}`);
    const md = readFileSync(tmpOnline, "utf8");
    assert.ok(md.startsWith("---\n"), "online SKILL.md has frontmatter");
    assert.match(md, /TYPEUI_SH_MANAGED_START/, "online managed marker");
    assert.match(md, /^## Style Foundations$/m, "online Style Foundations");
    console.log(`[e2e online] typeui.sh: ${Date.now() - onlineStart} ms`);
  } else {
    console.log("[e2e online] skipped (set E2E_ONLINE=1 to enable)");
  }

  console.log("E2E tests passed.");
} finally {
  cleanup();
}
