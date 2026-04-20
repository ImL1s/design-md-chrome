#!/usr/bin/env node
/*
 * Downgrade scaffold: v0.6 (β concat-core era) payload → v0.5 (α CDP-inject era).
 * Currently a no-op because v0.6 has not shipped. When β lands, this script must:
 *   1. Strip any fields introduced in v0.6 (e.g., concat-core specific diagnostics)
 *   2. Decrement __schemaVersion from 2 to 1
 *   3. Re-validate via lib/schema.mjs::validateSchema
 *
 * Idempotent: running twice on the same payload is a no-op.
 *
 * Usage:
 *   node scripts/downgrade-v0.6-to-v0.5.mjs --input <payload.json> --output <path>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { validateSchema, SCHEMA_VERSION } from "../lib/schema.mjs";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" }
  }
});

if (!values.input || !values.output) {
  process.stderr.write("Usage: downgrade-v0.6-to-v0.5.mjs --input <path> --output <path>\n");
  process.exit(2);
}

const payload = JSON.parse(readFileSync(values.input, "utf8"));

// v0.6 → v0.5: no schema bump has occurred yet (α path selected, β deferred).
if (payload.__schemaVersion === undefined || payload.__schemaVersion === 1) {
  process.stderr.write(
    `downgrade: input already at or below schema 1 (current=${payload.__schemaVersion}); no-op.\n`
  );
  writeFileSync(values.output, JSON.stringify(payload, null, 2) + "\n");
  process.exit(0);
}

if (payload.__schemaVersion === 2) {
  // TODO(β ship): strip v0.6-only fields here.
  payload.__schemaVersion = 1;
  validateSchema(payload);
  writeFileSync(values.output, JSON.stringify(payload, null, 2) + "\n");
  process.stderr.write(`downgrade: schema 2 → 1 (scaffold, no field strip yet). SCHEMA_VERSION=${SCHEMA_VERSION}\n`);
  process.exit(0);
}

process.stderr.write(`downgrade: unsupported schema version ${payload.__schemaVersion}; upgrade design-md or use matching downgrade script.\n`);
process.exit(1);
