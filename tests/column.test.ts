import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatColumnDataForState,
  registerCCFColumn,
  unpackColumnData,
} from "../src/modules/column";
import { ItemRankState } from "../src/modules/types";

function buildState(overrides: Partial<ItemRankState> = {}): ItemRankState {
  return {
    itemKey: "1:100",
    status: "matched",
    source: "auto",
    rank: "B",
    updatedAt: "2026-10-28T15:00:00.000Z",
    ...overrides,
  };
}

describe("CCF column display formatting", () => {
  it("falls back to fullName when the matched venue has no abbreviation", () => {
    // Neural Networks 在 CCF 目录中没有官方简称（abbr 为空），
    // 曾因 rank && abbr 条件不满足而被误显示为 Unknown。
    const packed = formatColumnDataForState(
      buildState({
        abbr: "",
        fullName: "Neural Networks",
        category: "人工智能",
        venueText: "Neural Networks",
        confidence: 0.96,
        matchedField: "publicationTitle",
        matchedValue: "Neural Networks",
      }),
    );
    const { display, title, sortKey } = unpackColumnData(packed);

    assert.equal(display, "CCF B | Neural Networks");
    assert.ok(title.includes("人工智能"));
    assert.ok(sortKey.startsWith("020"));
  });

  it("keeps showing the abbreviation when one exists", () => {
    const packed = formatColumnDataForState(
      buildState({
        abbr: "TNNLS",
        fullName: "IEEE Transactions on Neural Networks and Learning Systems",
        category: "人工智能",
        venueText: "IEEE TNNLS",
        confidence: 1,
      }),
    );
    const { display } = unpackColumnData(packed);

    assert.equal(display, "CCF B | TNNLS");
  });

  it("repairs legacy manual states that stored an empty abbr", () => {
    // 手动指定历史版本写入 venueText: venue.abbr（可能为空），
    // 但 fullName 始终存在，展示不应退化为 Unknown。
    const packed = formatColumnDataForState(
      buildState({
        source: "manual",
        abbr: "",
        fullName: "Neural Computation",
        category: "人工智能",
        venueText: "",
        confidence: 1,
      }),
    );
    const { display } = unpackColumnData(packed);

    assert.equal(display, "CCF B | Neural Computation");
  });

  it("falls back to venueText when abbr and fullName are missing", () => {
    const packed = formatColumnDataForState(
      buildState({
        abbr: "",
        fullName: "",
        venueText: "Neural Networks",
      }),
    );
    const { display } = unpackColumnData(packed);

    assert.equal(display, "CCF B | Neural Networks");
  });

  it("still renders Unknown only for genuinely unresolved states", () => {
    const packed = formatColumnDataForState(
      buildState({
        status: "unknown",
        rank: undefined,
        abbr: undefined,
        fullName: undefined,
        venueText: undefined,
        confidence: 0,
      }),
    );
    const { display } = unpackColumnData(packed);

    assert.equal(display, "Unknown");
  });

  it("appends the publication year to the display without affecting sort keys", () => {
    const packed = formatColumnDataForState(
      buildState({
        abbr: "AAAI",
        fullName: "AAAI Conference on Artificial Intelligence",
        venueText: "AAAI",
      }),
      { year: 2026 },
    );
    const { display, title, sortKey } = unpackColumnData(packed);

    assert.equal(display, "CCF B | AAAI 2026");
    assert.ok(title.startsWith("CCF B | AAAI 2026"));
    // 排序键仍基于不带年份的 venue 名，追加年份不改变排序行为。
    assert.ok(sortKey.startsWith("020"));
    assert.ok(!sortKey.includes("2026"));

    const noAbbr = unpackColumnData(
      formatColumnDataForState(
        buildState({ abbr: "", fullName: "Neural Networks", venueText: "Neural Networks" }),
        { year: "2026" },
      ),
    );
    assert.equal(noAbbr.display, "CCF B | Neural Networks 2026");
    assert.ok(noAbbr.sortKey.startsWith("020"));
  });

  it("skips the year suffix when the venue text already ends with the same year", () => {
    const packed = formatColumnDataForState(
      buildState({ abbr: "", fullName: "", venueText: "AAAI 2026" }),
      { year: "2026" },
    );
    const { display } = unpackColumnData(packed);

    assert.equal(display, "CCF B | AAAI 2026");
  });

  it("shows standalone arXiv with its submission year, when available", () => {
    const state = buildState({ status: "preprint", rank: undefined, preprintSignal: true });
    const withYear = unpackColumnData(formatColumnDataForState(state, { year: 2027, style: "compact" }));
    const withoutYear = unpackColumnData(formatColumnDataForState(state, { style: "compact" }));
    assert.equal(withYear.display, "arXiv 2027");
    assert.equal(withoutYear.display, "arXiv");
    assert.equal(withYear.sortKey, withoutYear.sortKey);
    assert.ok(withYear.title.startsWith("arXiv 2027"));
  });

  it("formats matched and non-CCF venues in both selectable styles", () => {
    const matched = buildState({ rank: "A", abbr: "AAAI" });
    const none = buildState({ status: "none", rank: undefined, venueText: "Local Venue" });
    assert.equal(unpackColumnData(formatColumnDataForState(matched, { year: 2027 })).display, "CCF A | AAAI 2027");
    assert.equal(unpackColumnData(formatColumnDataForState(matched, { year: 2027, style: "compact" })).display, "A|AAAI 2027");
    assert.equal(unpackColumnData(formatColumnDataForState(none)).display, "CCF None | Local Venue");
    assert.equal(unpackColumnData(formatColumnDataForState(none, { style: "compact" })).display, "None|Local Venue");
  });

  it("retains colors for abbreviated ranks, non-CCF venues and arXiv", async () => {
    const previous = (globalThis as any).Zotero;
    let column: any;
    (globalThis as any).Zotero = {
      ItemTreeManager: { async registerColumns(value: any) { column = value; } },
    };
    try {
      await registerCCFColumn();
      const doc = {
        createElement() {
          return { style: {}, appendChild(child: any) { (this as any).child = child; } };
        },
      };
      for (const [display, color] of [
        ["CCF A | AAAI 2027", "#dff3e8"], ["CCF B | EMNLP", "#e8eefc"],
        ["CCF C | Venue", "#fff2cc"], ["CCF T1 | Venue", "#dcfce7"],
        ["CCF T2 | Venue", "#e0f2fe"], ["CCF T3 | Venue", "#fef3c7"],
        ["CCF None | Venue", "#f1e5f6"], ["Preprint | arXiv 2027", "#edf0f4"],
        ["A|AAAI 2027", "#dff3e8"], ["B|EMNLP", "#e8eefc"],
        ["C|Venue", "#fff2cc"], ["T1|Venue", "#dcfce7"],
        ["T2|Venue", "#e0f2fe"], ["T3|Venue", "#fef3c7"],
        ["None|Venue", "#f1e5f6"], ["arXiv 2027", "#edf0f4"],
        ["Unknown", "#f4e8e8"],
      ]) {
        const cell = column.renderCell(0, display, { className: "test" }, false, doc);
        assert.equal(cell.child.style.backgroundColor, color, display);
      }
    } finally {
      (globalThis as any).Zotero = previous;
    }
  });

  it("ignores invalid year values", () => {
    const packed = formatColumnDataForState(buildState({ abbr: "AAAI" }), {
      year: "abc",
    });
    const { display } = unpackColumnData(packed);

    assert.equal(display, "CCF B | AAAI");
  });
});
