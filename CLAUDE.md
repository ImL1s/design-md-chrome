# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Manifest V3 Chrome extension that extracts design tokens (typography, colors, spacing, motion, shadows) from any webpage and generates `DESIGN.md` / `SKILL.md` files for AI coding tools (Claude Code, Cursor, Codex, Google Stitch). Homepage: https://www.typeui.sh — file format: https://www.typeui.sh/design-md

## Stack

Vanilla JavaScript, **no** bundler, no `package.json`, no linter/formatter config. `lib/*.mjs` and `tests/*.mjs` are ES modules; `service-worker.js` is a module service worker (`"type": "module"` in `manifest.json`); `content-script.js` is an IIFE injected via `chrome.scripting.executeScript`.

## Commands

- Tests: `node tests/run-tests.mjs` (bare `node:assert/strict`, no npm dependencies).
- Icons: `bash scripts/generate-icons.sh`.
- No build/lint/format step — reload the unpacked extension at `chrome://extensions` after code changes. See `.claude/skills/reload-extension/SKILL.md` for the full reload matrix.

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
