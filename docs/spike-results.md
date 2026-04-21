# CDP-Inject Spike Results (US-004)

Ran: `2026-04-20T18:19:02.343Z`
World: isolated (worldName="typeui-extractor"), via `Page.addScriptToEvaluateOnNewDocument`

## Overall verdict: **PASS** → **α path** — ship v0.5 CDP-inject CLI (US-005a), defer shared-core refactor

## Per-target results

| Target | URL | Mode | Verdict | Nav (ms) | Notes |
|---|---|---|---|---|---|
| fixture | file:///Users/setsuna/Documents/design-md-chrome/tests/fixtures/sample-dashboard.html | baseline-compare | PASS | 571 | matches baseline |
| typeui.sh | https://www.typeui.sh | structural | PASS | 1989 | typography=219 colors=219 sampled=219/1046 |
| github.com | https://github.com | structural-trusted-types | PASS | 2493 | typography=250 colors=250 sampled=250/1907 |
| stripe.com | https://stripe.com | structural-csp | PASS | 3002 | typography=1 colors=1 sampled=1/3 |

## Worlds / CSP / Trusted Types observations

- **Isolated world**: `Page.addScriptToEvaluateOnNewDocument` with `worldName` creates a per-page isolated JS context, equivalent to an extension content-script's isolated world. This bypasses the page's Trusted Types CSP (`require-trusted-types-for 'script'`, enforced by GitHub) because the isolated world is not subject to page-level Trusted Types enforcement.
- **CSP `script-src`**: does not apply to scripts injected via CDP `Page.addScriptToEvaluateOnNewDocument` — CDP-privileged injection is exempt from page CSP.
- **Same-origin**: the isolated world shares the page's DOM (cross-world DOM access is allowed) but has a separate `window` proxy. `window.__typeuiExtract` lives in the isolated world's `window`; `document.querySelectorAll` still sees the page's DOM.
- **Risks remaining**: shadow DOM (open shadow roots visible via `.shadowRoot`, closed ones not), cross-origin iframes (isolated worlds are per-frame; top-frame isolated world cannot extract from cross-origin child frames without per-frame injection).

## Decision

All 4 targets extracted via isolated-world CDP injection. **Proceed with α path**: ship v0.5 as a thin CLI that CDP-injects the unchanged `content-script.js`. Defer shared-core refactor (β) until a second consumer demands it.

## Artifacts

- Captured payloads: `tests/fixtures/spike-output/{fixture,typeui.sh,github.com,stripe.com}.json`
- Baseline: `tests/fixtures/sample-dashboard.baseline.json`
- Oracle: `tests/check-contract.mjs`
