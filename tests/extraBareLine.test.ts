import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatItemDiagnostics } from "../src/modules/diagnostics";
import { resolveItemMatch } from "../src/modules/venueResolver";

function makeItem(
  fields: Record<string, string>,
  itemType = "conferencePaper",
  id = 910,
): Zotero.Item {
  return {
    libraryID: 1,
    id,
    itemType,
    getField(field: string) {
      return fields[field] || "";
    },
  } as unknown as Zotero.Item;
}

describe("bare extra venue lines", () => {
  it("matches a venue name written directly in Extra without any key prefix", () => {
    const item = makeItem({ extra: "AAAI" });
    const result = resolveItemMatch(item);

    assert.equal(result.status, "matched");
    assert.equal(result.abbr, "AAAI");
    assert.ok(result.matchedField?.startsWith("extra:bare"));
  });

  it("carries the trailing year of a bare venue line", () => {
    const item = makeItem({ extra: "NAACL 2025" });
    const result = resolveItemMatch(item);

    assert.equal(result.status, "matched");
    assert.equal(result.abbr, "NAACL");
    assert.equal(result.year, "2025");
  });

  it("never matches a submission note that merely starts with a venue name", () => {
    // "ICLR submission" 只能走开头简称匹配（置信度 0.92），
    // 裸行通道要求精确命中（≥0.96），必须拒绝。
    const item = makeItem({ extra: "ICLR submission" });
    const result = resolveItemMatch(item);

    assert.notEqual(result.status, "matched");
  });

  it("ignores common noise lines (pages, links, ids, other plugins)", () => {
    const cases = [
      "arXiv:2503.22005 [cs.IR]",
      "17 pages, 3 figures",
      "https://github.com/kookeej/CORAL",
      "GS Rank: Q1",
      "Comments: 9 pages, 2 figures",
      "DOI: 10.48550/arXiv.2503.22005",
    ];
    for (const extra of cases) {
      const item = makeItem({ extra });
      const result = resolveItemMatch(item);
      assert.notEqual(
        result.status,
        "matched",
        `should not match bare line: ${extra}`,
      );
    }
  });

  it("lets a keyed venue line outrank a bare line", () => {
    const item = makeItem({ extra: "CCF Venue: AAAI\nICLR" });
    const result = resolveItemMatch(item);

    assert.equal(result.status, "matched");
    assert.equal(result.abbr, "AAAI");
  });

  it("explains the bare-line channel in diagnostics", () => {
    const item = makeItem({ extra: "AAAI" });
    const report = formatItemDiagnostics(item);

    assert.ok(report.includes("Extra 裸行（仅精确命中）"));
  });
});
