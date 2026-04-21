---
name: verify
description: Run the full verification pass for this Chrome extension — tests, manifest.json validity, and JavaScript syntax checks. Use before commits or when you want to be sure a change did not break anything.
---

# /verify

Run every step below. Do not stop at the first failure — run all steps, then report everything at once so the user can fix in one pass.

## 1. Run tests

```bash
node tests/run-tests.mjs
```

Must exit 0 and print a success line. Any assertion failure is a verification failure.

## 2. Validate manifest.json

```bash
node -e "const m = JSON.parse(require('fs').readFileSync('manifest.json','utf8')); if (m.manifest_version !== 3) throw new Error('manifest_version must be 3'); if (!/^\d+\.\d+\.\d+$/.test(m.version)) throw new Error('version must be SemVer x.y.z');"
```

Confirms the file parses, `manifest_version` is `3`, and `version` is `x.y.z` SemVer.

## 3. Syntax-check JS modules

```bash
for f in lib/*.mjs tests/*.mjs service-worker.js content-script.js; do
  node --check "$f" || echo "SYNTAX ERROR: $f"
done
```

Catches parse-level mistakes the test hook will not always surface (e.g., unused files).

## 4. Report

- **Pass**: one line — `verify: ok`.
- **Fail**: list each failed step, exact error, and likely cause.

## Notes

- A bundled `/oh-my-claudecode:verify` skill also exists; this project skill is additive and enforces the checks specific to this Chrome extension.
- These same checks run automatically via hooks after edits to watched files — use `/verify` when you want a full manual sweep regardless of what was edited.
