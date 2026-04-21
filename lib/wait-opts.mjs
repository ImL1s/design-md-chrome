// SPA-ready wait option parsing for design-md CLI v0.6 (US-003).
// Pure parser: string input → { ok, value } | { ok: false, reason }.

export const MAX_WAIT_MS = 30000;
export const DEFAULT_SELECTOR_TIMEOUT_MS = 30000;

// Parse --wait <ms>. Accepts non-negative integer string only (no leading "+",
// no decimals, no scientific notation). Caps at 30000.
export function parseWaitMs(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: 0 };
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) {
    return { ok: false, reason: "must be a non-negative integer (ms)" };
  }
  const n = Number(s);
  if (n > MAX_WAIT_MS) {
    return { ok: false, reason: `must be <= ${MAX_WAIT_MS}` };
  }
  return { ok: true, value: n };
}

// Parse selector timeout override from DESIGN_MD_SELECTOR_TIMEOUT env var.
// Silently falls back to default on malformed input — internal test knob only.
export function resolveSelectorTimeout(envVal) {
  if (envVal === undefined || envVal === null || envVal === "") return DEFAULT_SELECTOR_TIMEOUT_MS;
  const n = Number.parseInt(String(envVal), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SELECTOR_TIMEOUT_MS;
}
