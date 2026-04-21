# Migration

Schema-version and payload-shape migration policy for `design-md` / `design-md-chrome`.

Source of truth: `lib/schema.mjs` (`SCHEMA_VERSION`, `writeWithSchema`, `validateSchema`).

## Current state

- **Package version**: `0.5.0` (α path — CDP-inject CLI)
- **Schema version**: `1`
- **Payloads are stamped** via `writeWithSchema()` in `bin/design-md.mjs` (CLI, `--dump-payload` and internal writes)
- **Chrome extension** (`service-worker.js`) does not currently persist payloads to `chrome.storage.local`; when that gate lands, the same `writeWithSchema()` helper will be used to mirror `__schemaVersion` onto storage

## Per-version pair matrix

| From → To | Path | Schema Δ | Forward | Downgrade |
|---|---|---|---|---|
| 0.4 → 0.5 | **α (CDP-inject CLI)** | none | ship CLI; extension unchanged | `npm uninstall -g design-md` (extension v0.4 still works) |
| 0.5 → 0.6 | **β add concat-core**, CDP retained as fallback | 1 → 2 | `scripts/upgrade-v0.5-to-v0.6.mjs` (stub) — adds `__schemaVersion: 2` and new fields | `scripts/downgrade-v0.6-to-v0.5.mjs` (stub) — strips new fields, downgrades schema |
| 0.6 → 0.7 | **deprecate CDP path** | 2 → 3 | `scripts/upgrade-v0.6-to-v0.7.mjs` (TBD) | `scripts/downgrade-v0.7-to-v0.6.mjs` (TBD) |

Downgrade scripts must be **idempotent**: running twice on the same payload is a no-op.

## `__schemaVersion` semantics

- **Missing**: treated as legacy v0 (pre-schema). Reject on write; upgrade on read with a warning.
- **Equal**: OK.
- **Lower than installed**: auto-migrate forward via `scripts/upgrade-v{low}-to-v{installed}.mjs`, chained if needed.
- **Higher than installed**: `validateSchema` throws. User must either upgrade `design-md` or run the matching downgrade script.

## Chrome extension storage (future)

When `service-worker.js` gains persistent storage:

```js
// pseudo-code, lands in US-008 follow-up
import { writeWithSchema, validateSchema, SCHEMA_VERSION } from "./lib/schema.mjs";

async function writePayload(payload) {
  const stamped = writeWithSchema(payload);
  await chrome.storage.local.set({ "typeui:lastPayload": stamped, "typeui:schemaVersion": SCHEMA_VERSION });
}

async function readPayload() {
  const data = await chrome.storage.local.get(["typeui:lastPayload"]);
  if (data["typeui:lastPayload"]) validateSchema(data["typeui:lastPayload"]);
  return data["typeui:lastPayload"];
}
```

`chrome.storage.local.schemaVersion` must match the payload's `__schemaVersion`. Startup performs: `if (storage < installed) run migration; if (storage > installed) refuse with downgrade hint`.

## Manifest vs package version

- `manifest.json` `version` is the Chrome Web Store release signal.
- `package.json` `version` mirrors it. Bump via the `/release` skill (see `.claude/skills/release/SKILL.md`) which updates both + tags + pushes. Never bump one without the other.
