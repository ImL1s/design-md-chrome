// Pure CSS-vars formatter for design-md CLI v0.6 (US-002).
// Emits a single `:root { ... }` block with sections for colors, font sizes,
// font families, spacings, and radii. Deterministic output: same input → same
// bytes. Empty sections are omitted (no dangling `/* Colors */\n}`).

function normalizeFamily(value) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const parts = raw
    .split(",")
    .map((item) => item.trim())
    .map((item) => item.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return parts.join(", ");
}

function topFontFamilies(payload, n) {
  const counts = new Map();
  for (const row of payload?.typography || []) {
    const family = normalizeFamily(row?.fontFamily);
    if (!family) continue;
    counts.set(family, (counts.get(family) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([family]) => family);
}

function quoteFamilyStack(family) {
  return family
    .split(",")
    .map((seg) => {
      const s = seg.trim();
      if (!s) return "";
      if (/^["'].*["']$/.test(s)) return s;
      return /\s/.test(s) ? `"${s}"` : s;
    })
    .filter(Boolean)
    .join(", ");
}

function emitSection(lines, label, rows) {
  const keep = rows.filter((r) => typeof r.value === "string" && r.value);
  if (!keep.length) return;
  lines.push(`  /* ${label} */`);
  for (const { name, value } of keep) lines.push(`  ${name}: ${value};`);
}

function take(items, prefix, limit, valueOf = (row) => row?.value) {
  const list = Array.isArray(items) ? items : [];
  return list.slice(0, limit).map((row, i) => ({
    name: `--${prefix}-${i + 1}`,
    value: valueOf(row)
  }));
}

export function generateCssVars({ normalized, payload }) {
  const lines = [":root {"];

  emitSection(lines, "Colors", take(normalized?.colorPalette, "color", 5));
  emitSection(lines, "Font sizes", take(normalized?.typographyScale, "font-size", 3));
  emitSection(
    lines,
    "Font families",
    topFontFamilies(payload, 3).map((family, i) => ({
      name: `--font-family-${i + 1}`,
      value: quoteFamilyStack(family)
    }))
  );
  emitSection(lines, "Spacings", take(normalized?.spacingScale, "spacing", 3));
  emitSection(lines, "Radii", take(normalized?.radiusTokens, "radius", 3));

  lines.push("}");
  return lines.join("\n") + "\n";
}

export const __test__ = { normalizeFamily };
