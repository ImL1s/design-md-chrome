# Baseline capture

`tests/fixtures/sample-dashboard.baseline.json` is the oracle for the Day-0 CDP-inject spike (US-004) and future regression tests. It represents the payload that the extension's `content-script.js` produces on the fixture `tests/fixtures/sample-dashboard.html` when run in a real headless Chromium.

## When to regenerate

Only regenerate when the extension's extraction contract intentionally changes:

- You modified `content-script.js` and the change is a deliberate payload-shape update (not a bug fix that happens to change output within tolerance)
- You modified the fixture HTML and want the baseline to track the new fixture
- Chrome/Chromium major upgrade changes computed-style output in ways that require re-pinning

Do **not** regenerate just to make a failing `check-contract` pass. If the contract fails, first investigate whether the change is a regression.

## How to run

```bash
npm install           # first-run only, installs puppeteer-core + chrome-launcher
npm run capture:baseline
```

What happens:

1. `chrome-launcher` locates your installed Chrome (macOS: `/Applications/Google Chrome.app`; Linux: `google-chrome`)
2. Chrome is launched headlessly with `--font-render-hinting=none` and `--no-sandbox`
3. `puppeteer-core` connects via the debug port
4. The fixture is loaded via `file://` URL; `document.fonts.ready` is awaited
5. `content-script.js` is read and patched in memory — the `chrome.runtime.onMessage.addListener` block is replaced with `window.__typeuiExtract = extractStylesFromPage` so Puppeteer can invoke the function directly (the DOM-extraction body is untouched; this preserves single source of truth)
6. `window.__typeuiExtract()` runs and returns the payload
7. ISO-8601 timestamps and `*At` keys are normalized to the `__TS__` sentinel
8. The normalized payload is written to `tests/fixtures/sample-dashboard.baseline.json`
9. A self-check runs: `node tests/check-contract.mjs --baseline <baseline> --target <baseline>` — must exit 0

## Troubleshooting

- **`chrome-launcher: No chrome installations found`**: install Google Chrome, or set `CHROME_PATH` env to point at the binary
- **Self-check fails with hash drift**: `content-script.js` produced different top-N colors/fontSizes/fontFamilies than a previous baseline — verify this is intentional before committing
- **`patchContentScript: could not locate chrome.runtime.onMessage.addListener block`**: the content-script structure changed; update the regex in `scripts/capture-baseline.mjs` or restructure content-script back to expose `extractStylesFromPage` as a pure function
- **Fonts look different from production Chrome**: the Docker/CI environment is missing font packages; install `fonts-liberation` + `fonts-noto-core` on Linux hosts
