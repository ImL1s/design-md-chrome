# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Manifest V3 Chrome extension that extracts design tokens (typography, colors, spacing, motion, shadows) from any webpage and generates `DESIGN.md` / `SKILL.md` files for AI coding tools (Claude Code, Cursor, Codex, Google Stitch). Homepage: https://www.typeui.sh — file format: https://www.typeui.sh/design-md

## Stack

Vanilla JavaScript. `lib/*.mjs` and `tests/*.mjs` are ES modules; `service-worker.js` is a module service worker (`"type": "module"` in `manifest.json`); `content-script.js` is an IIFE injected via `chrome.scripting.executeScript`. `package.json` exists for CLI distribution (v0.5+); `puppeteer-core` and `chrome-launcher` are declared as **optional peer dependencies** so validate-only installs do not pull ~170MB Chromium. No linter/formatter config by design; no bundler — the β-path shared-core flow (if adopted) uses a simple concat script (`scripts/build-content-script.mjs`), not webpack/esbuild.

## Commands

- Unit tests: `node tests/run-tests.mjs` (bare `node:assert/strict`).
- Contract check: `node tests/check-contract.mjs --baseline <path> --target <path>`.
- Capture baseline: `npm run capture:baseline` (requires `npm install` first; launches real Chrome).
- CLI (once shipped): `npx design-md extract <url> [--mode design|skill] [--output <path>] [--verbose]`.
- Icons: `bash scripts/generate-icons.sh`.
- No lint/format step — reload the unpacked extension at `chrome://extensions` after code changes. See `.claude/skills/reload-extension/SKILL.md` for the full reload matrix.

## Development workflow

- **TDD Red-Green-Refactor**: for any change to `lib/*.mjs`, `src/extract-core.js` (β path), or extraction logic, write a failing test first (in `tests/run-tests.mjs` or a new `tests/*.mjs` file), then implement, then refactor.
- **Structural-contract non-regression**: any extraction change must keep the output passing `tests/check-contract.mjs` against the committed baseline. Byte-identical output is **not** required; the contract covers keys/types/cardinality, numeric tolerance (hex exact, px ±1, others ±2%), canonicalized `fontFamily`, and SHA-256 content-hashes of top5Colors + top3FontSizes + top3FontFamilies. Intentional payload changes must regenerate `tests/fixtures/sample-dashboard.baseline.json` in the same commit and document the reason in `docs/baseline-capture.md`.
- **Concat build (β path only)**: if `src/extract-core.js` becomes the single source of truth, `scripts/build-content-script.mjs` injects it into `scripts/content-script.template.js` at the `/*EXTRACT_CORE_INJECTION_POINT*/` marker. Never hand-edit `content-script.js` in β mode — the CI guard (`git diff --exit-code` + marker grep + `node --check`) will fail the PR.

## Gotchas

- **Content-script idempotency**: do not remove or rename `window.__typeuiStyleExtractorInstalled` in `content-script.js`. Double-install breaks extraction.
- **Managed-block markers**: generated files wrap content in `<!-- TYPEUI_SH_MANAGED_START -->` / `<!-- TYPEUI_SH_MANAGED_END -->`. Downstream tooling rewrites only the block inside — preserve the markers in `lib/generate-*.mjs`.
- **DOM sampling cap**: `content-script.js` samples at most 280 elements. Raising it can OOM extraction.
- **Service worker is a module** — use `import`, not `importScripts()`.
- **`manifest.json` `version` field** is the release signal. Bump it via the `/release` skill; do not hand-bump without `/release` unless the skill is unavailable.

## Conventions (not linted)

- camelCase for functions and variables; UPPER_SNAKE for constants.
- Commit style: lowercase prefix — `update: …`, `fix: …`, `add: …` (see `git log`).

## Automation

Hooks in `.claude/settings.json` run `node tests/run-tests.mjs` after edits to `lib/**/*.mjs`, `tests/**/*.mjs`, `service-worker.js`, or `content-script.js`, and validate `manifest.json` JSON after edits. Do not disable them without reason.
