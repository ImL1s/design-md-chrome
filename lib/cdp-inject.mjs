// Shared helpers for CDP-inject flows (bin/design-md.mjs, scripts/capture-baseline.mjs,
// scripts/spike-cdp-inject.mjs). The extension's `content-script.js` is an IIFE whose only
// side effect besides the idempotency sentinel is registering a `chrome.runtime.onMessage`
// listener. `patchContentScript` swaps that listener for a direct `window.__typeuiExtract`
// handle so Puppeteer/CDP flows can invoke the function without a Chrome runtime.

export const TIMESTAMP_SENTINEL = "__TS__";
export const TIMESTAMP_KEY_RE = /(sampledAt|timestamp|capturedAt|createdAt|updatedAt)$/i;

export function patchContentScript(src) {
  const patched = src.replace(
    /chrome\.runtime\.onMessage\.addListener\([\s\S]*?\n\s*\}\);/m,
    "window.__typeuiExtract = extractStylesFromPage;"
  );
  if (patched === src) {
    throw new Error(
      "patchContentScript: could not locate chrome.runtime.onMessage.addListener block — " +
      "content-script.js structure may have changed."
    );
  }
  return patched;
}

export function normalizeTimestamps(obj) {
  if (Array.isArray(obj)) return obj.map(normalizeTimestamps);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = TIMESTAMP_KEY_RE.test(k) ? TIMESTAMP_SENTINEL : normalizeTimestamps(v);
    }
    return out;
  }
  return obj;
}
