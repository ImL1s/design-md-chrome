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

console.log("All tests passed.");
