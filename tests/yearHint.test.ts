import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatColumnDataForState, unpackColumnData } from "../src/modules/column";
import { formatItemDiagnostics } from "../src/modules/diagnostics";
import { matchCandidates } from "../src/modules/matcher";
import { ItemRankState } from "../src/modules/types";
import { resolveItemMatch, resolveVenueCandidates } from "../src/modules/venueResolver";

function makeItem(
  fields: Record<string, string>,
  itemType = "conferencePaper",
  id = 900,
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

describe("venue-annotated year channel", () => {
  it("extracts the trailing year from an extra venue line and carries it through matching", () => {
    // 真实场景：webpage 剪藏条目 date 是提交日（2025-10-10），真实届次 AAAI-2026；
    // 手动在 Extra 标注 "CCF Venue: AAAI 2026" 是唯一可靠的年份来源。
    const item = makeItem({ extra: "CCF Venue: AAAI 2026" }, "webpage");
    const resolution = resolveVenueCandidates(item);
    const result = matchCandidates(resolution.candidates, resolution.isPreprint);

    assert.equal(result.status, "matched");
    assert.equal(result.abbr, "AAAI");
    assert.equal(result.year, "2026");
  });

  it("lets the venue-annotated year override the item date year in the column", () => {
    const state: ItemRankState = {
      itemKey: "1:900",
      status: "matched",
      source: "auto",
      rank: "A",
      abbr: "AAAI",
      matchYear: "2026",
      updatedAt: "2026-10-30T00:00:00.000Z",
    };
    const packed = formatColumnDataForState(state, { year: "2025" });
    const { display, sortKey } = unpackColumnData(packed);

    assert.equal(display, "CCF A | AAAI 2026");
    // 排序键不受任何年份影响。
    assert.ok(!sortKey.includes("2026"));
    assert.ok(!sortKey.includes("2025"));
  });

  it("falls back to the item date year when no venue year is annotated", () => {
    const state: ItemRankState = {
      itemKey: "1:901",
      status: "matched",
      source: "auto",
      rank: "A",
      abbr: "AAAI",
      updatedAt: "2026-10-30T00:00:00.000Z",
    };
    const packed = formatColumnDataForState(state, { year: "2025" });
    const { display } = unpackColumnData(packed);

    assert.equal(display, "CCF A | AAAI 2025");
  });

  it("reports the year source in diagnostics", () => {
    const venueItem = makeItem({ extra: "CCF Venue: AAAI 2026" }, "webpage");
    const venueReport = formatItemDiagnostics(venueItem);
    assert.ok(venueReport.includes("结果：CCF A | AAAI 2026"));
    assert.ok(venueReport.includes("显示年份：2026（来源：venue 标注年份）"));

    const dateItem = makeItem(
      {
        extra: "CCF Venue: AAAI",
        date: "2025-10-10 2025/10/10",
      },
      "webpage",
      901,
    );
    const dateReport = formatItemDiagnostics(dateItem);
    assert.ok(dateReport.includes("结果：CCF A | AAAI 2025"));
    assert.ok(dateReport.includes("显示年份：2025（来源：条目 Date 字段）"));
  });

  it("matches venues whose text itself ends with a year and keeps the year", () => {
    const item = makeItem({
      proceedingsTitle:
        "Proceedings of the AAAI Conference on Artificial Intelligence 2026",
    });
    const result = matchCandidates(
      resolveVenueCandidates(item).candidates,
      false,
    );

    assert.equal(result.status, "matched");
    assert.equal(result.abbr, "AAAI");
    assert.equal(result.year, "2026");
  });

  it("applies the annotated year even when another venue candidate matches first", () => {
    // journalArticle 的 publicationTitle 候选排在 extra 前面并精确命中，
    // 年份标注是条目级信号，不能因为"别的候选先命中"而丢失。
    const item = makeItem(
      {
        publicationTitle: "Information Processing & Management",
        extra: "CCF Venue: IPM 2026",
      },
      "journalArticle",
      904,
    );
    const result = resolveItemMatch(item);

    assert.equal(result.status, "matched");
    assert.equal(result.abbr, "IPM");
    assert.equal(result.year, "2026");
  });

  it("never falls back to the arXiv submission year for accepted preprints", () => {
    // 场景：2026 年上传的 arXiv 论文中了 AAAI-2027。条目 Date 是提交日，
    // 与录取届次必然无关，因此 date 年份不参与兜底。
    const state: ItemRankState = {
      itemKey: "1:902",
      status: "matched",
      source: "auto",
      rank: "A",
      abbr: "AAAI",
      preprintSignal: true,
      updatedAt: "2026-10-30T00:00:00.000Z",
    };
    const packed = formatColumnDataForState(state, { year: "2026" });
    const { display } = unpackColumnData(packed);

    assert.equal(display, "CCF A | AAAI");
    assert.ok(!display.includes("2026"));
  });

  it("shows the annotated year for accepted preprints", () => {
    const item = makeItem(
      {
        archiveID: "arXiv:2601.12345",
        extra: "CCF Venue: AAAI 2027",
        date: "2026-01-10 2026-01-10",
      },
      "preprint",
      902,
    );
    const resolution = resolveVenueCandidates(item);
    const result = matchCandidates(resolution.candidates, resolution.isPreprint);

    assert.equal(result.status, "matched");
    assert.equal(result.abbr, "AAAI");
    assert.equal(result.year, "2027");
    assert.equal(result.preprintSignal, true);

    const state: ItemRankState = {
      itemKey: "1:902",
      status: "matched",
      source: "auto",
      rank: result.rank,
      abbr: result.abbr,
      matchYear: result.year,
      preprintSignal: true,
      updatedAt: "2026-10-30T00:00:00.000Z",
    };
    const { display } = unpackColumnData(formatColumnDataForState(state, { year: "2026" }));
    assert.equal(display, "CCF A | AAAI 2027");
  });

  it("explains the suppressed year in diagnostics for accepted preprints", () => {
    const item = makeItem(
      {
        archiveID: "arXiv:2601.12345",
        extra: "CCF Venue: AAAI",
        date: "2026-01-10 2026-01-10",
      },
      "preprint",
      903,
    );
    const report = formatItemDiagnostics(item);

    assert.ok(report.includes("结果：CCF A | AAAI\n"));
    assert.ok(
      report.includes("显示年份：无（preprint 条目的 Date 是提交日期"),
    );
    assert.ok(report.includes("CCF Venue: AAAI 2027"));
  });
});
