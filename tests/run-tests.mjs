import assert from "node:assert/strict";
import { normalizeExtractedStyles } from "../lib/normalize.mjs";
import { generateDesignMarkdown } from "../lib/generate-design-md.mjs";
import { generateSkillMarkdown } from "../lib/generate-skill-md.mjs";
import { validateMarkdownOutput } from "../lib/validate.mjs";

const mockPayload = {
  source: {
    url: "https://example.com/dashboard",
    title: "Example Dashboard"
  },
  sampledAt: "2026-04-14T12:00:00.000Z",
  totalElements: 460,
  sampledElements: 120,
  typography: [
    { fontFamily: "\"Inter\", \"Helvetica Neue\", Arial, sans-serif", fontSize: "14px", lineHeight: "20px", fontWeight: "400" },
    { fontFamily: "\"Inter\", \"Helvetica Neue\", Arial, sans-serif", fontSize: "16px", lineHeight: "24px", fontWeight: "400" },
    { fontFamily: "\"Inter\", \"Helvetica Neue\", Arial, sans-serif", fontSize: "16px", lineHeight: "24px", fontWeight: "400" },
    { fontFamily: "\"Inter\", \"Helvetica Neue\", Arial, sans-serif", fontSize: "20px", lineHeight: "28px", fontWeight: "600" }
  ],
  colors: [
    { textColor: "rgb(17, 24, 39)", backgroundColor: "rgb(255, 255, 255)", borderColor: "rgb(229, 231, 235)", outlineColor: "rgb(59, 130, 246)" },
    { textColor: "rgb(75, 85, 99)", backgroundColor: "rgb(249, 250, 251)", borderColor: "rgb(209, 213, 219)", outlineColor: "rgb(59, 130, 246)" },
    { textColor: "rgb(17, 24, 39)", backgroundColor: "rgb(255, 255, 255)", borderColor: "rgb(229, 231, 235)", outlineColor: "rgb(59, 130, 246)" }
  ],
  spacing: [
    {
      marginTop: "8px",
      marginRight: "16px",
      marginBottom: "8px",
      marginLeft: "16px",
      paddingTop: "12px",
      paddingRight: "16px",
      paddingBottom: "12px",
      paddingLeft: "16px"
    }
  ],
  radius: ["6px", "8px", "8px"],
  shadows: ["none", "0 1px 2px rgba(0, 0, 0, 0.08)"],
  motion: [
    {
      transitionDuration: "150ms",
      transitionTimingFunction: "ease-in-out",
      animationDuration: "0s",
      animationTimingFunction: "ease"
    }
  ],
  components: [
    { type: "buttons", count: 12 },
    { type: "inputs", count: 9 },
    { type: "navigation", count: 2 }
  ],
  siteSignals: {
    title: "Example Dashboard",
    description: "Manage your workspace, analytics, billing, and team settings.",
    keywords: "dashboard, analytics, reports, workspace, admin",
    ogType: "website",
    ogSiteName: "Example",
    appName: "Example App",
    pathname: "/app/dashboard",
    hostname: "example.com",
    headings: ["Team Dashboard", "Usage Analytics"],
    navTexts: ["Dashboard", "Reports", "Settings", "Billing", "Users"],
    ctaTexts: ["Invite user", "Save settings"],
    textSample: "Use this workspace dashboard to manage team projects, billing, reports, and account settings.",
    elementCounts: {
      forms: 4,
      inputs: 22,
      tables: 2,
      codeBlocks: 0,
      articles: 0,
      pricingSections: 0,
      productMarkers: 0,
      authMarkers: 3,
      checkoutMarkers: 0
    }
  }
};

const normalized = normalizeExtractedStyles(mockPayload);

assert.ok(normalized.typographyScale.length >= 3, "typography scale should be inferred");
assert.equal(normalized.mainFontStyle.primaryFamily, "Inter", "main font family should be inferred");
assert.ok(normalized.colorPalette.length >= 3, "color palette should be inferred");
assert.ok(normalized.spacingScale.length >= 2, "spacing scale should be inferred");

const designMd = generateDesignMarkdown({
  normalized,
  metadata: {
    systemName: "Example DS",
    brand: "Example"
  }
});

const skillMd = generateSkillMarkdown({
  normalized,
  metadata: {
    systemName: "Example DS",
    brand: "Example"
  }
});

const designValidation = validateMarkdownOutput("design", designMd);
const skillValidation = validateMarkdownOutput("skill", skillMd);

assert.ok(designValidation.isValid, `DESIGN.md should be valid: ${designValidation.errors.join(", ")}`);
assert.ok(skillValidation.isValid, `SKILL.md should be valid: ${skillValidation.errors.join(", ")}`);
assert.ok(skillMd.includes("TYPEUI_SH_MANAGED_START"), "SKILL.md should include managed markers");
assert.ok(designMd.includes("WCAG 2.2 AA"), "DESIGN.md should include accessibility target");
assert.ok(designMd.includes("- URL: https://example.com/dashboard"), "DESIGN.md should include extraction URL");
assert.ok(designMd.includes("- Main font style: `font.family.primary=Inter`"), "DESIGN.md should include inferred main font style");
assert.ok(skillMd.includes("- URL: https://example.com/dashboard"), "SKILL.md should include extraction URL");
assert.ok(skillMd.includes("- Main font style: `font.family.primary=Inter`"), "SKILL.md should include inferred main font style");
assert.ok(designMd.includes("- Audience: authenticated users and operators"), "DESIGN.md should infer audience from site signals");
assert.ok(designMd.includes("- Product surface: dashboard web app"), "DESIGN.md should infer product surface from site signals");
assert.ok(skillMd.includes("- Product surface: dashboard web app"), "SKILL.md should infer product surface from site signals");
assert.ok(!designMd.includes("Audience/surface inference confidence"), "DESIGN.md should not include inference confidence text");
assert.ok(!skillMd.includes("Audience/surface inference confidence"), "SKILL.md should not include inference confidence text");

import {
  checkContract,
  normalizeFontFamily,
  normalizeColor,
  parsePx,
  computeContentHashes
} from "./check-contract.mjs";

// check-contract: self-check — identical payload passes
{
  const { ok, errors: errs } = checkContract(mockPayload, mockPayload);
  assert.ok(ok, `baseline vs baseline should pass, got: ${errs.join("; ")}`);
}

// check-contract: hex/rgb color mismatch fails (exact, not tolerance)
{
  const a = { colors: [{ textColor: "#111827" }] };
  const b = { colors: [{ textColor: "#111828" }] };
  const { ok, errors: errs } = checkContract(a, b);
  assert.ok(!ok, "single-bit hex drift should fail");
  assert.ok(errs.some(e => /color mismatch/.test(e)), `expected color mismatch, got: ${errs.join("; ")}`);
}

// check-contract: rgb normalizes to hex — cross-format equivalence passes
{
  const a = { typography: [{ fontSize: "16px" }], colors: [{ textColor: "rgb(17, 24, 39)" }] };
  const b = { typography: [{ fontSize: "16px" }], colors: [{ textColor: "#111827" }] };
  const { ok } = checkContract(a, b);
  assert.ok(ok, "rgb(17,24,39) and #111827 should normalize equal");
}

// check-contract: px tolerance boundary on non-top-N field — ±1 passes, >1 fails
{
  const a = { spacing: [{ paddingLeft: "16px" }] };
  const b = { spacing: [{ paddingLeft: "17px" }] };
  assert.ok(checkContract(a, b).ok, "px diff of 1 on non-top-N should pass");
  const c = { spacing: [{ paddingLeft: "18px" }] };
  assert.ok(!checkContract(a, c).ok, "px diff of 2 should fail");
}

// check-contract: content-hash catches top-N fontSize drift (even single-px)
{
  const a = { typography: [{ fontSize: "16px" }, { fontSize: "20px" }] };
  const b = { typography: [{ fontSize: "17px" }, { fontSize: "20px" }] };
  const { ok, errors: errs } = checkContract(a, b);
  assert.ok(!ok, "top-N fontSize change should fail via hash even within px tolerance");
  assert.ok(errs.some(e => /top3FontSizes drift/.test(e)), `expected top3FontSizes drift, got: ${errs.join("; ")}`);
}

// check-contract: fontFamily canonicalization
{
  assert.equal(
    normalizeFontFamily('"Inter", "Helvetica Neue", sans-serif'),
    "inter, helvetica neue, sans-serif"
  );
  assert.equal(normalizeFontFamily("Inter,sans-serif"), "inter, sans-serif");
  const a = { typography: [{ fontFamily: '"Inter", "Helvetica Neue"' }] };
  const b = { typography: [{ fontFamily: "Inter,Helvetica Neue" }] };
  assert.ok(checkContract(a, b).ok, "fontFamily quote/whitespace drift should pass after canonicalization");
}

// check-contract: content-hash catches reordering of top colors (cardinality equal)
{
  const a = { colors: [{ a: "#aaaaaa" }, { a: "#bbbbbb" }, { a: "#cccccc" }] };
  const b = { colors: [{ a: "#bbbbbb" }, { a: "#aaaaaa" }, { a: "#cccccc" }] };
  const { ok, errors: errs } = checkContract(a, b);
  assert.ok(!ok, "top colors reorder should fail via content-hash");
  assert.ok(errs.some(e => /top5Colors drift/.test(e)), `expected top5Colors hash drift, got: ${errs.join("; ")}`);
}

// check-contract: timestamp normalization
{
  const a = { sampledAt: "2026-04-21T01:00:00.000Z" };
  const b = { sampledAt: "2026-04-22T02:00:00.000Z" };
  assert.ok(checkContract(a, b).ok, "differing ISO timestamps should be normalized equal");
}

// check-contract: malformed input — null / type mismatch caught
{
  assert.ok(!checkContract({ x: 1 }, { x: "1" }).ok, "type mismatch should fail");
  assert.ok(!checkContract({ x: null }, { x: 1 }).ok, "null vs number should fail");
}

// check-contract: helpers
{
  assert.equal(normalizeColor("RGB(17, 24, 39)"), "#111827");
  assert.equal(normalizeColor("#FFF"), "#ffffff");
  assert.equal(parsePx("16px"), 16);
  assert.equal(parsePx("  -4px  "), -4);
  assert.equal(parsePx("16"), null);
  const h = computeContentHashes({ colors: [{ a: "#aaaaaa" }] });
  assert.match(h.top5Colors, /^[0-9a-f]{64}$/, "hash is 64 hex chars");
}

// ============================================================================
// US-001 Batch helpers (lib/batch.mjs)
// ============================================================================
import { parseUrlListFile, slugifyUrl, isSingleFileOutputPath } from "../lib/batch.mjs";
import { writeFileSync as _writeFileSync, mkdtempSync as _mkdtempSync, rmSync as _rmSync } from "node:fs";
import { tmpdir as _tmpdir } from "node:os";
import { join as _join } from "node:path";

// slugifyUrl: hostname + pathname canonicalization
{
  assert.equal(slugifyUrl("https://example.com/"), "example.com-index", "empty path → index");
  assert.equal(slugifyUrl("https://example.com"), "example.com-index", "no path → index");
  assert.equal(slugifyUrl("https://example.com/foo/bar"), "example.com-foo-bar", "nested path dashed");
  assert.equal(slugifyUrl("https://EXAMPLE.com/X"), "example.com-X", "hostname lowercased, path case kept");
  assert.equal(slugifyUrl("https://a.b.c/page.html"), "a.b.c-page", ".html extension stripped");
  assert.equal(slugifyUrl("https://a.b/deep/page.htm"), "a.b-deep-page", ".htm stripped from last segment");
  assert.equal(slugifyUrl("file:///abs/dir/file.html"), "local-abs-dir-file", "file:// with empty hostname");
  assert.equal(slugifyUrl("https://x.y/a?v=1"), "x.y-a-v-1", "query string folded");
  assert.equal(
    slugifyUrl("https://x.y/?q=hello world&z=1"),
    "x.y-q-hello-world-z-1",
    "special chars collapsed to hyphen"
  );
  // Determinism: same input, same output
  assert.equal(slugifyUrl("https://x.y/a"), slugifyUrl("https://x.y/a"), "deterministic");
}

// parseUrlListFile: comments, blanks, CRLF
{
  const dir = _mkdtempSync(_join(_tmpdir(), "design-md-batch-"));
  try {
    const p = _join(dir, "urls.txt");
    _writeFileSync(
      p,
      "# first comment\r\nhttps://a.com\r\n\r\n# another\nhttps://b.com/page\n   \n   https://c.com/x   \n"
    );
    const urls = parseUrlListFile(p);
    assert.deepEqual(
      urls,
      ["https://a.com", "https://b.com/page", "https://c.com/x"],
      "parse strips comments/blanks/CRLF/surrounding whitespace"
    );
  } finally {
    _rmSync(dir, { recursive: true, force: true });
  }
}

// parseUrlListFile: missing file throws
{
  assert.throws(
    () => parseUrlListFile("/nonexistent/__design_md_batch__.txt"),
    /ENOENT|no such file/,
    "missing file throws"
  );
}

// isSingleFileOutputPath: extension detection
{
  assert.ok(isSingleFileOutputPath("out.md"), "out.md is single-file");
  assert.ok(isSingleFileOutputPath("path/to/out.json"), "out.json is single-file");
  assert.ok(isSingleFileOutputPath("OUT.MD"), "case-insensitive");
  assert.ok(!isSingleFileOutputPath("outdir"), "no ext → not single-file");
  assert.ok(!isSingleFileOutputPath("some.dir/name"), "dot in dir name ok");
  assert.ok(!isSingleFileOutputPath("out.txt"), ".txt is not single-file");
}

// ============================================================================
// US-002 generateCssVars (lib/generate-css-vars.mjs)
// ============================================================================
import { generateCssVars, __test__ as cssVarsInternals } from "../lib/generate-css-vars.mjs";

// 5-color palette produces --color-1 ... --color-5
{
  const normalizedWith5 = {
    colorPalette: [
      { token: "color.text.primary", value: "#111827" },
      { token: "color.surface.base", value: "#ffffff" },
      { token: "color.border.default", value: "#e5e7eb" },
      { token: "color.focus.ring", value: "#2563eb" },
      { token: "color.text.secondary", value: "#4b5563" },
      { token: "color.text.tertiary", value: "#9ca3af" } // overflow, should be dropped
    ],
    typographyScale: [],
    spacingScale: [],
    radiusTokens: []
  };
  const css = generateCssVars({ normalized: normalizedWith5, payload: null });
  for (let i = 1; i <= 5; i++) {
    assert.ok(css.includes(`--color-${i}:`), `expected --color-${i}`);
  }
  assert.ok(!css.includes("--color-6:"), "should not emit --color-6 when only 5 requested");
  assert.ok(css.includes("#111827"), "palette value preserved");
  assert.ok(css.includes("/* Colors */"), "Colors section comment");
}

// Font families canonicalized (double-quote wrap for whitespace names)
{
  const payload = {
    typography: [
      { fontFamily: "Inter, sans-serif" },
      { fontFamily: "Inter, sans-serif" },
      { fontFamily: "Helvetica Neue, Arial, sans-serif" },
      { fontFamily: '"Roboto Mono", monospace' }
    ]
  };
  const css = generateCssVars({
    normalized: { colorPalette: [], typographyScale: [], spacingScale: [], radiusTokens: [] },
    payload
  });
  assert.ok(css.includes("--font-family-1: Inter, sans-serif;"), "top family unquoted single-word");
  assert.ok(
    css.includes('--font-family-2: "Helvetica Neue", Arial, sans-serif;') ||
    css.includes('--font-family-2: "Roboto Mono", monospace;'),
    "second family quoted for whitespace"
  );
  // Sorted by frequency desc; ties broken by localeCompare → deterministic
  const helvIdx = css.indexOf("Helvetica Neue");
  const robotoIdx = css.indexOf("Roboto Mono");
  assert.ok(helvIdx >= 0 || robotoIdx >= 0, "at least one multi-word family emitted");
}

// Empty sections are OMITTED (no dangling section comments)
{
  const empty = {
    colorPalette: [],
    typographyScale: [],
    spacingScale: [],
    radiusTokens: []
  };
  const css = generateCssVars({ normalized: empty, payload: { typography: [] } });
  assert.equal(css, ":root {\n}\n", "fully empty emits minimal :root block");
  assert.ok(!css.includes("/* Colors */"), "no empty Colors section comment");
  assert.ok(!css.includes("/* Font sizes */"), "no empty Font sizes section comment");
  assert.ok(!css.includes("/* Spacings */"), "no empty Spacings section");
  assert.ok(!css.includes("/* Radii */"), "no empty Radii section");
}

// Determinism: same input → same bytes
{
  const normalized = {
    colorPalette: [{ token: "color.text.primary", value: "#111827" }],
    typographyScale: [{ token: "font.size.xs", value: "14px" }],
    spacingScale: [],
    radiusTokens: []
  };
  const payload = { typography: [{ fontFamily: "Inter" }] };
  const a = generateCssVars({ normalized, payload });
  const b = generateCssVars({ normalized, payload });
  assert.equal(a, b, "deterministic output");
}

// Top-3 font-size truncation
{
  const normalized = {
    colorPalette: [],
    typographyScale: [
      { token: "font.size.xs", value: "12px" },
      { token: "font.size.sm", value: "14px" },
      { token: "font.size.md", value: "16px" },
      { token: "font.size.lg", value: "20px" }
    ],
    spacingScale: [],
    radiusTokens: []
  };
  const css = generateCssVars({ normalized, payload: null });
  assert.ok(css.includes("--font-size-1: 12px;"), "first font-size");
  assert.ok(css.includes("--font-size-3: 16px;"), "third font-size");
  assert.ok(!css.includes("--font-size-4:"), "fourth font-size truncated");
}

// normalizeFamily helper: strips quotes, lowercases stays as original case
{
  const { normalizeFamily } = cssVarsInternals;
  assert.equal(normalizeFamily('"Inter", "Helvetica Neue", sans-serif'), "Inter, Helvetica Neue, sans-serif");
  assert.equal(normalizeFamily("Inter,sans-serif"), "Inter, sans-serif");
  assert.equal(normalizeFamily(""), "");
  assert.equal(normalizeFamily("  Inter  "), "Inter");
}

// ============================================================================
// US-003 wait-opts (lib/wait-opts.mjs)
// ============================================================================
import { parseWaitMs, resolveSelectorTimeout, MAX_WAIT_MS, DEFAULT_SELECTOR_TIMEOUT_MS } from "../lib/wait-opts.mjs";

// parseWaitMs: accepts valid integers
{
  assert.deepEqual(parseWaitMs(undefined), { ok: true, value: 0 }, "undefined → 0");
  assert.deepEqual(parseWaitMs(null), { ok: true, value: 0 }, "null → 0");
  assert.deepEqual(parseWaitMs("0"), { ok: true, value: 0 }, "0 is valid");
  assert.deepEqual(parseWaitMs("500"), { ok: true, value: 500 }, "500 is valid");
  assert.deepEqual(parseWaitMs("30000"), { ok: true, value: 30000 }, "30000 (cap) is valid");
  assert.deepEqual(parseWaitMs("  100  "), { ok: true, value: 100 }, "trimmed");
}

// parseWaitMs: rejects invalid
{
  const r1 = parseWaitMs("-1");
  assert.ok(!r1.ok, "negative rejected");
  const r2 = parseWaitMs("abc");
  assert.ok(!r2.ok, "non-numeric rejected");
  const r3 = parseWaitMs("1.5");
  assert.ok(!r3.ok, "decimal rejected");
  const r4 = parseWaitMs("30001");
  assert.ok(!r4.ok, "over cap rejected");
  assert.match(r4.reason, /30000/, "reason mentions cap");
  const r5 = parseWaitMs("1e3");
  assert.ok(!r5.ok, "scientific rejected");
  const r6 = parseWaitMs("+5");
  assert.ok(!r6.ok, "leading + rejected");
}

// resolveSelectorTimeout: env var parsing
{
  assert.equal(resolveSelectorTimeout(undefined), DEFAULT_SELECTOR_TIMEOUT_MS, "undefined → default");
  assert.equal(resolveSelectorTimeout(""), DEFAULT_SELECTOR_TIMEOUT_MS, "empty → default");
  assert.equal(resolveSelectorTimeout("2000"), 2000, "valid number");
  assert.equal(resolveSelectorTimeout("abc"), DEFAULT_SELECTOR_TIMEOUT_MS, "bad string → default");
  assert.equal(resolveSelectorTimeout("0"), DEFAULT_SELECTOR_TIMEOUT_MS, "0 → default (guard)");
  assert.equal(resolveSelectorTimeout("-100"), DEFAULT_SELECTOR_TIMEOUT_MS, "negative → default");
}

// Constants exposed
{
  assert.equal(MAX_WAIT_MS, 30000);
  assert.equal(DEFAULT_SELECTOR_TIMEOUT_MS, 30000);
}

console.log("All tests passed.");
