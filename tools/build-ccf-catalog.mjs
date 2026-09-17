#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node tools/build-ccf-catalog.mjs --input <path> [options]",
    "",
    "Examples:",
    "  node tools/build-ccf-catalog.mjs --input ccf-latest.csv",
    "  node tools/build-ccf-catalog.mjs --input new-venues.csv --merge",
    "  node tools/build-ccf-catalog.mjs --input ccf-updated.json --version CCF-2026-v8",
    "",
    "Options:",
    "  --input         Path to input file (CSV, TSV, or JSON)",
    "  --output        Output JSON path (default: src/data/ccf-2026.json)",
    "  --version       Catalog version label (default: preserves existing or generates new)",
    "  --merge         Merge into existing catalog instead of replacing entirely",
    "  --source        Source description text",
  ].join("\n");
}

function parseDelimited(textValue, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < textValue.length; index++) {
    const char = textValue[index];
    const next = textValue[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function rowsFromDelimited(rawText, delimiter) {
  const table = parseDelimited(rawText.replace(/^\uFEFF/, ""), delimiter);
  if (table.length < 2) {
    throw new Error("CSV/TSV input must contain a header row and at least one data row");
  }

  const headers = table[0].map((header) => header.trim());
  return table.slice(1).map((values) => {
    const row = {};
    for (const [index, header] of headers.entries()) {
      row[header] = values[index] ?? "";
    }
    return row;
  });
}

function normalizeKind(rawKind) {
  const text = (rawKind || "").trim().toLowerCase();
  if (text.includes("会议") || text === "conference" || text === "conf") {
    return "conference";
  }
  if (text.includes("期刊") || text === "journal" || text === "jnl") {
    return "journal";
  }
  return "conference";
}

function normalizeRank(rawRank) {
  const text = (rawRank || "").trim().toUpperCase();
  const match = text.match(/\b([ABC]|T[123])\b/);
  if (match) return match[1];
  if (text.includes("A")) return "A";
  if (text.includes("B")) return "B";
  if (text.includes("C")) return "C";
  throw new Error(`Invalid CCF rank value: "${rawRank}". Expected A, B, or C.`);
}

function pickField(row, candidates) {
  for (const candidate of candidates) {
    if (candidate in row && row[candidate] !== undefined && row[candidate] !== null) {
      const val = String(row[candidate]).trim();
      if (val) return val;
    }
    // Case-insensitive fallback
    for (const key of Object.keys(row)) {
      if (key.trim().toLowerCase() === candidate.toLowerCase()) {
        const val = String(row[key]).trim();
        if (val) return val;
      }
    }
  }
  return "";
}

export function parseVenueRow(row) {
  const kind = normalizeKind(
    pickField(row, ["kind", "type", "类型", "刊物类型", "会议/期刊", "类别"]) || "conference",
  );
  const abbr = pickField(row, ["abbr", "shortName", "简称", "缩写", "刊物简称"]);
  const fullName = pickField(row, ["fullName", "name", "title", "全称", "刊物全称", "会议全称", "名称"]);
  const rank = normalizeRank(
    pickField(row, ["rank", "level", "等级", "推荐等级", "级别"]) || "C",
  );
  const category =
    pickField(row, ["category", "field", "大类", "分类", "学科分类", "学科领域", "领域"]) ||
    "通用计算机科学";

  if (!fullName && !abbr) {
    return null;
  }

  const rawAliases = pickField(row, ["aliases", "alias", "别名"]);
  const aliasesSet = new Set();
  if (abbr) aliasesSet.add(abbr);
  if (fullName) aliasesSet.add(fullName);

  if (rawAliases) {
    const parts = rawAliases.split(/[;\r\n,，|]/).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) aliasesSet.add(p);
  }

  return {
    kind,
    abbr: abbr || fullName,
    fullName: fullName || abbr,
    rank,
    category,
    aliases: [...aliasesSet],
  };
}

export function buildCcfCatalog(rawContent, format = "csv", existingCatalog = null, options = {}) {
  let rows = [];

  if (format === "json") {
    const parsed = typeof rawContent === "string" ? JSON.parse(rawContent) : rawContent;
    rows = Array.isArray(parsed) ? parsed : (parsed.venues || parsed.data || []);
  } else if (format === "tsv") {
    rows = rowsFromDelimited(rawContent, "\t");
  } else {
    rows = rowsFromDelimited(rawContent, ",");
  }

  const newVenues = [];
  for (const row of rows) {
    const venue = parseVenueRow(row);
    if (venue) newVenues.push(venue);
  }

  if (newVenues.length === 0) {
    throw new Error("No valid venues found in input data.");
  }

  let finalVenues = [];
  if (options.merge && existingCatalog?.venues) {
    const venueMap = new Map();
    // Load existing
    for (const v of existingCatalog.venues) {
      venueMap.set(`${v.fullName.toLowerCase()}:::${v.kind}`, v);
    }
    // Merge or overwrite with new
    for (const v of newVenues) {
      const key = `${v.fullName.toLowerCase()}:::${v.kind}`;
      const existing = venueMap.get(key);
      if (existing) {
        // Merge aliases
        const mergedAliases = [...new Set([...(existing.aliases || []), ...(v.aliases || [])])];
        venueMap.set(key, { ...existing, ...v, aliases: mergedAliases });
      } else {
        venueMap.set(key, v);
      }
    }
    finalVenues = [...venueMap.values()];
  } else {
    finalVenues = newVenues;
  }

  const today = new Date().toISOString().slice(0, 10);
  const version = options.version || existingCatalog?.version || `CCF-${new Date().getFullYear()}-updated`;
  const source = options.source || `Imported via build-ccf-catalog on ${today}`;

  return {
    version,
    updateDate: today,
    source,
    venues: finalVenues,
  };
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith("build-ccf-catalog.mjs")) {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input) {
    console.error(usage());
    process.exit(1);
  }

  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output || "src/data/ccf-2026.json");
  const ext = (args.format || extname(inputPath).slice(1)).toLowerCase();

  console.log(`Reading ${inputPath}...`);
  const rawContent = readFileSync(inputPath, "utf8");

  let existingCatalog = null;
  if (args.merge) {
    try {
      existingCatalog = JSON.parse(readFileSync(outputPath, "utf8"));
    } catch {
      console.log(`No existing catalog found at ${outputPath}, creating new.`);
    }
  }

  const catalog = buildCcfCatalog(rawContent, ext, existingCatalog, {
    version: args.version,
    merge: Boolean(args.merge),
    source: args.source,
  });

  writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(`Successfully written ${catalog.venues.length} venues to ${outputPath}.`);

  const confCount = catalog.venues.filter((v) => v.kind === "conference").length;
  const journalCount = catalog.venues.filter((v) => v.kind === "journal").length;
  console.log(`Summary: ${confCount} conferences, ${journalCount} journals.`);
}
