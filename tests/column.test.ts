import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatColumnDataForState,
  registerCCFColumn,
  unpackColumnData,
} from "../src/modules/column";
import {
  hasPendingInvalidationRecompute,
  resetInvalidationRecomputeForTest,
  runInvalidationRecomputeNow,
} from "../src/modules/invalidationRecompute";
import { getCatalogVersion, getMatcherVersion } from "../src/modules/matcher";
import { getColumnDisplayState, needsRankRecompute } from "../src/modules/rankService";
import { clearStorageMemoryCache } from "../src/modules/storage";
import { ITEM_STATE_VERSION, ItemRankState } from "../src/modules/types";
import { setCCFSortColumnKey } from "../src/modules/viewRefresh";

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

  it("keeps showing stale catalog cache in the column and migrates visible items in background", async () => {
    const prefs = new Map<string, string>();
    const arxivItem: any = {
      libraryID: 1,
      id: 501,
      itemType: "webpage",
      isAttachment: () => false,
      isNote: () => false,
      isRegularItem: () => true,
      getField: (field: string) =>
        ({
          title: "PersonaManifold",
          date: "2026/09/28",
          url: "https://arxiv.org/abs/2609.34571v1",
        })[field] || "",
    };
    const aclItem: any = {
      libraryID: 1,
      id: 502,
      itemType: "webpage",
      isAttachment: () => false,
      isNote: () => false,
      isRegularItem: () => true,
      getField: (field: string) =>
        ({
          title: "Preference Heads",
          date: "2026/04/24",
          url: "https://arxiv.org/abs/2604.22345v1",
          extra: "CCF Venue: ACL 2026",
        })[field] || "",
    };
    const procIeeeItem: any = {
      libraryID: 1,
      id: 503,
      itemType: "journalArticle",
      isAttachment: () => false,
      isNote: () => false,
      isRegularItem: () => true,
      getField: (field: string) =>
        ({
          publicationTitle: "Proceedings of the IEEE",
          date: "2025",
        })[field] || "",
    };
    const annotationItem: any = {
      libraryID: 1,
      id: 504,
      itemType: "annotation",
      isAttachment: () => false,
      isNote: () => false,
      isRegularItem: () => false,
      getField: () => "",
    };

    const ITEM_STATE_KEY = "extensions.ccf-for-zotero.itemState";
    prefs.set(
      ITEM_STATE_KEY,
      JSON.stringify({
        version: 1,
        items: {
          "1:501": {
            itemKey: "1:501",
            status: "preprint",
            source: "auto",
            venueText: "arXiv",
            preprintSignal: true,
            stateVersion: ITEM_STATE_VERSION,
            catalogVersion: "CCF-2026-v7-pdf-audited+CCF-HQJ-2025",
            matcherVersion: getMatcherVersion(),
            updatedAt: "2026-11-16T00:00:00.000Z",
          },
          "1:502": {
            itemKey: "1:502",
            status: "matched",
            source: "auto",
            rank: "A",
            abbr: "ACL",
            fullName: "Annual Meeting of the Association for Computational Linguistics",
            matchYear: "2026",
            preprintSignal: true,
            stateVersion: ITEM_STATE_VERSION,
            catalogVersion: "CCF-2026-v7-pdf-audited+CCF-HQJ-2025",
            matcherVersion: getMatcherVersion(),
            updatedAt: "2026-11-16T00:00:00.000Z",
          },
          "1:503": {
            itemKey: "1:503",
            status: "none",
            source: "auto",
            venueText: "Proceedings of the IEEE",
            stateVersion: ITEM_STATE_VERSION,
            catalogVersion: "CCF-2026-v7-pdf-audited+CCF-HQJ-2025",
            matcherVersion: getMatcherVersion(),
            updatedAt: "2026-11-16T00:00:00.000Z",
          },
        },
      }),
    );

    const items: Record<number, any> = {
      501: arxivItem,
      502: aclItem,
      503: procIeeeItem,
      504: annotationItem,
    };
    const originalZotero = (globalThis as any).Zotero;
    const originalZtoolkit = (globalThis as any).ztoolkit;
    let registeredColumn: any;
    (globalThis as any).Zotero = {
      ItemTreeManager: {
        async registerColumns(value: any) {
          registeredColumn = value;
          return ["ccf-column-key"];
        },
      },
      Items: {
        get(id: number | string) {
          return items[Number(id)] ?? false;
        },
      },
      getMainWindows: () => [],
      Prefs: {
        get(key: string) {
          return prefs.has(key) ? prefs.get(key) : "";
        },
        set(key: string, value: string) {
          prefs.set(key, value);
        },
        clear(key: string) {
          prefs.delete(key);
        },
      },
    };
    (globalThis as any).ztoolkit = { log() {} };

    try {
      clearStorageMemoryCache();
      resetInvalidationRecomputeForTest();
      await registerCCFColumn();

      // 目录版本升级后，列渲染立即平滑保留旧缓存，不瞬间抹为 Unknown。
      assert.equal(getColumnDisplayState(arxivItem).status, "preprint");
      assert.equal(unpackColumnData(registeredColumn.dataProvider(arxivItem)).display, "Preprint | arXiv 2026");
      assert.equal(unpackColumnData(registeredColumn.dataProvider(aclItem)).display, "CCF A | ACL 2026");
      assert.equal(unpackColumnData(registeredColumn.dataProvider(procIeeeItem)).display, "CCF None | Proceedings of the IEEE 2025");

      // 同时旧目录版本条目已进入后台迁移队列。
      assert.equal(needsRankRecompute(arxivItem), true);
      assert.equal(needsRankRecompute(aclItem), true);
      assert.equal(needsRankRecompute(procIeeeItem), true);
      assert.equal(hasPendingInvalidationRecompute(), true);

      const migrated = await runInvalidationRecomputeNow();
      assert.equal(migrated.ccfItems, 3);
      assert.equal(needsRankRecompute(arxivItem), false);
      assert.equal(needsRankRecompute(aclItem), false);
      assert.equal(needsRankRecompute(procIeeeItem), false);
      // 迁移后 Proceedings of the IEEE 自动从旧 None 升级为新目录 CCF A | Proc. IEEE。
      assert.equal(
        unpackColumnData(registeredColumn.dataProvider(procIeeeItem)).display,
        "CCF A | Proc. IEEE 2025",
      );
      assert.equal(
        JSON.parse(prefs.get(ITEM_STATE_KEY) || "{}").items["1:501"].catalogVersion,
        getCatalogVersion(),
      );

      // 已迁移条目与非普通条目（annotation）再次渲染时不会重复排队。
      assert.equal(hasPendingInvalidationRecompute(), false);
      registeredColumn.dataProvider(arxivItem);
      registeredColumn.dataProvider(annotationItem);
      assert.equal(hasPendingInvalidationRecompute(), false);
    } finally {
      clearStorageMemoryCache();
      resetInvalidationRecomputeForTest();
      setCCFSortColumnKey(undefined);
      (globalThis as any).Zotero = originalZotero;
      (globalThis as any).ztoolkit = originalZtoolkit;
    }
  });
});
