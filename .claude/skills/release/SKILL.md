---
name: release
description: Cut a new release of this Chrome extension — bumps version in manifest.json, commits, tags, and pushes. Chrome Web Store upload is separate (use the global chrome-webstore-manager skill for that).
disable-model-invocation: true
---

# /release

Usage: `/release patch|minor|major`. Defaults to `patch` if no argument.

## Preconditions

1. Working tree must be clean — `git status --porcelain` empty. Otherwise stop and tell the user to commit or stash first.
2. Branch must be `main` unless the user explicitly says otherwise.
3. `node tests/run-tests.mjs` must pass. If not, stop.
4. `git remote get-url origin` must point at the user's fork. Never push to an upstream the user does not own.

## Bump version

1. Read `"version"` from `manifest.json` (SemVer `x.y.z`).
2. Increment:
   - `patch` → `x.y.(z+1)`
   - `minor` → `x.(y+1).0`
   - `major` → `(x+1).0.0`
3. Write back with `Edit` preserving 2-space indent and trailing newline. Only the version line should change.

## Commit, tag, push

```bash
git add manifest.json
git commit -m "update: version bump to v<NEW>"
git tag "v<NEW>"
git push origin main
git push origin "v<NEW>"
```

If `git push` fails with non-fast-forward, stop and surface the error. Never force-push.

## Report

Output: new version, tag name, and remind the user to upload the built extension zip to Chrome Web Store via the global `chrome-webstore-manager` skill. This skill does not upload.
