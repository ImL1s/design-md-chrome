---
name: reload-extension
description: Reference for reloading this Chrome extension after code changes, including when content scripts and service workers need special handling. Use when a code change is done and needs to take effect in the browser.
---

# /reload-extension

Chrome has **no hot reload** for unpacked extensions — every code change requires a manual reload.

## General reload

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click the ↻ icon on the "DESIGN.md Style Extractor - TypeUI" card.

## When reload alone is not enough

| Change | Extra step |
|--------|------------|
| `service-worker.js` | Reload. If errors persist, click **Service worker** link on the card and restart via DevTools. |
| `content-script.js` | Reload, **then reload every tab** you want to test on — existing tabs still run the old injected script. |
| `manifest.json` permissions | Chrome shows a permission prompt on first reload. Accept it. |
| `popup/*` | Reload is enough; reopen the popup to pick up changes. |
| `lib/*.mjs` imported by service-worker or popup | Reload. If imports stay stale, close and reopen whatever triggers the import. |

## Debugging log locations

- **Service worker**: `chrome://extensions` → extension card → **Service worker** link. `console.log` shows up in that DevTools window, not the page console.
- **Content script**: open DevTools on the target page; logs land in the page console.
- **Popup**: right-click the popup → **Inspect**. Closing the popup closes its DevTools.

## Gotchas

- After editing `content-script.js`, refresh every tab you want to test on. A new tab is the cleanest path.
- If the extension misbehaves after many reloads, **remove** it and **load unpacked** again — Chrome caches manifest permissions aggressively.
- The content-script idempotency guard `window.__typeuiStyleExtractorInstalled` means a tab only runs extraction wiring once per page load; a tab reload resets it.
