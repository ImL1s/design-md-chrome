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
import { readFileSync, existsSync, unlinkSync, writeFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
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
const BATCH_URLS_TXT = resolve(REPO_ROOT, "tests/fixtures/integration-urls.txt");
const BATCH_DIR_OUT = resolve(REPO_ROOT, "tests/fixtures/integration-batch-out");

function cleanup() {
  for (const f of [PAYLOAD_OUT, DESIGN_MD_OUT, SKILL_MD_OUT, BATCH_URLS_TXT]) {
    if (existsSync(f)) unlinkSync(f);
  }
  if (existsSync(BATCH_DIR_OUT)) rmSync(BATCH_DIR_OUT, { recursive: true, force: true });
}

function run(args, timeout = 60000, env = {}) {
  return spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    timeout,
    env: { ...process.env, ...env },
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
    // Assert __schemaVersion is stamped on the dump-payload output (US-008 contract)
    const dumped = JSON.parse(readFileSync(PAYLOAD_OUT, "utf8"));
    assert.equal(dumped.__schemaVersion, 1, "dump-payload output must carry __schemaVersion: 1");
  }

  // 7. --verbose emits diagnostics to stderr
  {
    const r = run(["extract", FIXTURE_URL, "--mode", "design", "-o", DESIGN_MD_OUT, "--verbose"]);
    assert.equal(r.status, 0, `verbose exit 0, stderr: ${r.stderr}`);
    assert.match(r.stderr, /__schemaVersion":1/, "verbose emits __schemaVersion");
    assert.match(r.stderr, /sampledCount/, "verbose emits sampledCount");
    assert.match(r.stderr, /fontFallbackCount/, "verbose emits fontFallbackCount");
  }

  // ===== US-001 Batch mode =====
  const URL_A = FIXTURE_URL + "?v=a";
  const URL_B = FIXTURE_URL + "?v=b";

  // 8. Bad --input path exits 2 with clear error mentioning --input
  {
    const r = run(["extract", "--input", "/nonexistent/__design_md_none__.txt"]);
    assert.equal(r.status, 2, `bad --input exit 2, got ${r.status}`);
    assert.match(r.stderr, /--input/, "stderr mentions --input");
  }

  // 9. Batch rejects --output with .md extension (must be a directory)
  {
    const r = run(["extract", URL_A, URL_B, "-o", DESIGN_MD_OUT]);
    assert.equal(r.status, 2, `batch + .md output exit 2, got ${r.status}`);
    assert.match(r.stderr, /directory/i, "stderr says --output must be directory");
  }

  // 10. Batch positional (2 URLs) → stdout with `---` separator, 2 DESIGN.md heads
  {
    const r = run(["extract", URL_A, URL_B, "--mode", "design"], 120000);
    assert.equal(r.status, 0, `batch positional exit 0, stderr: ${r.stderr}`);
    const missionCount = (r.stdout.match(/## Mission/g) || []).length;
    assert.equal(missionCount, 2, `expected 2 Mission heads, got ${missionCount}`);
    assert.ok(r.stdout.includes("\n---\n"), "stdout has markdown separator");
    assert.match(r.stderr, /\[1\/2\] extracting/, "stderr progress 1/2");
    assert.match(r.stderr, /\[2\/2\] extracting/, "stderr progress 2/2");
    assert.match(r.stderr, /\[1\/2\] done in \d+ms/, "stderr reports duration");
  }

  // 11. Batch via --input → directory output, two distinct files
  {
    writeFileSync(BATCH_URLS_TXT, `# batch test\n${URL_A}\n\n${URL_B}\n`);
    const r = run(["extract", "--input", BATCH_URLS_TXT, "--mode", "design", "-o", BATCH_DIR_OUT], 120000);
    assert.equal(r.status, 0, `batch --input exit 0, stderr: ${r.stderr}`);
    const files = readdirSync(BATCH_DIR_OUT).filter(f => f.endsWith(".md"));
    assert.equal(files.length, 2, `expected 2 .md files in batch dir, got ${files.length}: ${files.join(", ")}`);
    // Sanity: both files are non-trivial DESIGN.md content
    for (const f of files) {
      const md = readFileSync(resolve(BATCH_DIR_OUT, f), "utf8");
      assert.ok(md.includes("## Mission"), `${f} missing Mission section`);
      assert.ok(md.length > 500, `${f} too short (${md.length} bytes)`);
    }
  }

  // ===== US-002 Multi-format output =====

  // 12. Invalid --format exits 2 (no Chrome launch)
  {
    const r = run(["extract", FIXTURE_URL, "--format", "yaml"]);
    assert.equal(r.status, 2, "bad --format exits 2");
    assert.match(r.stderr, /--format must be/, "stderr explains valid formats");
  }

  // 13. --format + --dump-payload mutex → exit 2 (no Chrome launch)
  {
    const r = run(["extract", FIXTURE_URL, "--format", "json", "--dump-payload"]);
    assert.equal(r.status, 2, "mutex violation exits 2");
    assert.match(r.stderr, /mutually exclusive/, "stderr explains mutex");
  }

  // 14. --format css-vars on fixture produces :root { + --color-1 on stdout
  {
    const r = run(["extract", FIXTURE_URL, "--format", "css-vars"]);
    assert.equal(r.status, 0, `css-vars exit 0, stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes(":root {"), "css-vars has :root {");
    assert.ok(r.stdout.includes("--color-1:"), "css-vars has --color-1");
    assert.ok(r.stdout.includes("/* Colors */"), "css-vars has Colors comment");
  }

  // 15. --format json + check-contract against baseline (byte-compat with --dump-payload)
  {
    const r = run(["extract", FIXTURE_URL, "--format", "json", "-o", PAYLOAD_OUT]);
    assert.equal(r.status, 0, `--format json exit 0, stderr: ${r.stderr}`);
    const check = spawnSync("node", [CHECK, "--baseline", BASELINE, "--target", PAYLOAD_OUT], { encoding: "utf8" });
    assert.equal(check.status, 0,
      `--format json vs baseline: check-contract exit 0 expected, got ${check.status}\n${check.stdout}\n${check.stderr}`
    );
    const dumped = JSON.parse(readFileSync(PAYLOAD_OUT, "utf8"));
    assert.equal(dumped.__schemaVersion, 1, "--format json must carry __schemaVersion: 1");
  }

  // 16. --dump-payload still works, emits deprecation warning on stderr
  {
    const r = run(["extract", FIXTURE_URL, "--dump-payload", "-o", PAYLOAD_OUT]);
    assert.equal(r.status, 0, `--dump-payload still works, got ${r.status}`);
    assert.match(r.stderr, /deprecated/, "stderr has deprecation warning");
    assert.match(r.stderr, /--format json/, "stderr suggests --format json");
    const dumped = JSON.parse(readFileSync(PAYLOAD_OUT, "utf8"));
    assert.equal(dumped.__schemaVersion, 1, "dump-payload still stamps schema");
  }

  // ===== US-003 Wait flags =====

  // 17. Invalid --wait exits 2 (no Chrome)
  {
    const r = run(["extract", FIXTURE_URL, "--wait", "-1"]);
    assert.equal(r.status, 2, "negative --wait exits 2");
    assert.match(r.stderr, /--wait/, "stderr mentions --wait");

    const r2 = run(["extract", FIXTURE_URL, "--wait", "abc"]);
    assert.equal(r2.status, 2, "non-numeric --wait exits 2");

    const r3 = run(["extract", FIXTURE_URL, "--wait", "99999"]);
    assert.equal(r3.status, 2, "--wait over cap exits 2");
  }

  // 18. --wait-selector timeout path + --wait extra delay → still succeeds.
  // Env var DESIGN_MD_SELECTOR_TIMEOUT=2000 shortens the 30s selector timeout
  // for CI; production default stays at 30s (verified via lib/wait-opts.mjs unit tests).
  {
    const r = run(
      ["extract", FIXTURE_URL, "--wait-selector", ".__definitely_not_here__", "--wait", "100", "-o", DESIGN_MD_OUT, "--verbose"],
      60000,
      { DESIGN_MD_SELECTOR_TIMEOUT: "2000" }
    );
    assert.equal(r.status, 0, `wait-selector timeout still extracts, stderr: ${r.stderr}`);
    assert.match(r.stderr, /--wait-selector timeout/, "stderr contains selector timeout warning");
    assert.match(r.stderr, /extra-wait 100ms/, "verbose logs extra-wait");
    const md = readFileSync(DESIGN_MD_OUT, "utf8");
    assert.ok(md.includes("## Mission"), "DESIGN.md still produced despite selector timeout");
  }

  console.log("Integration tests passed.");
} finally {
  cleanup();
}
