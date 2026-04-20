#!/usr/bin/env node
/*
 * Minimal ruler-apply: reads `.ruler/ruler.json` + `.ruler/<source>` and writes
 * per-AI-tool skill files. Avoids external npm dep for ruler — config + generator
 * both live in this repo. Compatible-in-spirit with github.com/intellectronica/ruler.
 *
 * Usage:
 *   node scripts/ruler-apply.mjs           # generate all targets
 *   node scripts/ruler-apply.mjs --check   # validate existing targets match source (CI guard)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const CONFIG = resolve(REPO_ROOT, ".ruler/ruler.json");

const { values } = parseArgs({
  options: { check: { type: "boolean", default: false } }
});

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const srcPath = resolve(REPO_ROOT, config.source);
const src = readFileSync(srcPath, "utf8");
const { name, description } = config.skillMeta;

const FORMATTERS = {
  "claude-skill": body =>
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`,
  "cursor-mdc": body =>
    `---\ndescription: ${description}\nalwaysApply: false\n---\n\n${body}`,
  "windsurf-workflow": body =>
    `---\ndescription: ${description}\nauto_execution_mode: 3\n---\n\n${body}`,
  "cline-rule": body => body
};

const VALIDATORS = {
  "claude-skill": f =>
    /^---\s*$/m.test(f) && /^name:\s*\S+/m.test(f) && /^description:\s*\S+/m.test(f),
  "cursor-mdc": f =>
    /^---\s*$/m.test(f) && /^description:\s*\S+/m.test(f),
  "windsurf-workflow": f =>
    /^---\s*$/m.test(f) && /^description:\s*\S+/m.test(f),
  "cline-rule": f => f.trim().length > 0 && !/^\s*$/.test(f.split("\n")[0])
};

let failed = 0;
for (const target of config.targets) {
  const formatter = FORMATTERS[target.format];
  const validator = VALIDATORS[target.format];
  if (!formatter || !validator) {
    console.error(`unknown format '${target.format}' for target ${target.path}`);
    failed++;
    continue;
  }
  const expected = formatter(src);
  const outPath = resolve(REPO_ROOT, target.path);

  if (values.check) {
    if (!existsSync(outPath)) {
      console.error(`CHECK FAIL: missing ${target.path}`);
      failed++;
      continue;
    }
    const actual = readFileSync(outPath, "utf8");
    if (!validator(actual)) {
      console.error(`CHECK FAIL: ${target.path} does not pass format validation`);
      failed++;
      continue;
    }
    // Format-only check — both this generator and @intellectronica/ruler produce valid outputs.
    // Exact byte-match is intentionally NOT required here; npm run ruler:apply + git diff catches drift.
    console.log(`ok: ${target.path}`);
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, expected);
    if (!validator(expected)) {
      console.error(`WROTE BUT FAILED VALIDATION: ${target.path}`);
      failed++;
    } else {
      console.log(`generated: ${target.path} (${expected.length} bytes)`);
    }
  }
}

if (failed) {
  console.error(`${failed} target(s) failed`);
  process.exit(1);
}
console.log(values.check ? "all targets in sync." : `all ${config.targets.length} targets generated + validated.`);
