import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatColumnDataForState, unpackColumnData } from "../src/modules/column";
import { getCCFSortMode, setCCFSortMode } from "../src/modules/sortPreferences";
import { ItemRankState } from "../src/modules/types";

function state(overrides: Partial<ItemRankState> = {}): ItemRankState {
  return { itemKey: "1:1", status: "matched", source: "auto", rank: "A", abbr: "Venue", updatedAt: "2026-01-01", ...overrides };
}

function packed(item: ItemRankState, year?: number, sortMode: "rank" | "year" = "year"): string {
  return formatColumnDataForState(item, { year, sortMode });
}

const collator = new Intl.Collator("en", { sensitivity: "base" });

describe("CCF sort modes", () => {
  it("defaults to the existing rank order and validates preferences", () => {
    const previous = (globalThis as any).Zotero;
    let value: unknown;
    (globalThis as any).Zotero = { Prefs: { get: () => value, set: (_key: string, v: unknown) => { value = v; } }, getMainWindows: () => [] };
    try {
      assert.equal(getCCFSortMode(), "rank");
      value = "invalid";
      assert.equal(getCCFSortMode(), "rank");
      setCCFSortMode("year");
      assert.equal(getCCFSortMode(), "year");
      assert.throws(() => setCCFSortMode("other" as any));
    } finally {
      (globalThis as any).Zotero = previous;
    }
  });

  it("orders newest years first and ranks within each year", () => {
    const items = [
      { label: "2025 A", data: packed(state(), 2025) },
      { label: "2026 preprint", data: packed(state({ status: "preprint", rank: undefined, abbr: undefined }), 2026) },
      { label: "2026 B", data: packed(state({ rank: "B", abbr: "B venue" }), 2026) },
      { label: "2026 A", data: packed(state({ rank: "A", abbr: "Z venue" }), 2026) },
      { label: "2026 C", data: packed(state({ rank: "C" }), 2026) },
      { label: "unknown year", data: packed(state()) },
    ];
    items.sort((a, b) => collator.compare(a.data, b.data));
    assert.deepEqual(items.map((item) => item.label), ["2026 A", "2026 B", "2026 C", "2026 preprint", "2025 A", "unknown year"]);
  });

  it("uses the same reliable year as display and keeps matched arXiv in its rank", () => {
    const match = state({ rank: "A", matchYear: "2024", preprintSignal: true });
    const matched = unpackColumnData(packed(match, 2026));
    const preprint = unpackColumnData(packed(state({ status: "preprint", rank: undefined, abbr: undefined }), 2024));
    assert.match(matched.display, /2024$/);
    assert.ok(collator.compare(matched.sortKey, preprint.sortKey) < 0);
    const noVenueYear = unpackColumnData(packed(state({ preprintSignal: true }), 2026));
    assert.ok(noVenueYear.sortKey.startsWith("1"));
    assert.doesNotMatch(noVenueYear.display, /2026/);
  });

  it("retains original keys unless year mode is explicitly selected", () => {
    const item = state({ rank: "B", abbr: "AAAI" });
    assert.equal(unpackColumnData(packed(item, 2025, "rank")).sortKey, unpackColumnData(packed(item, 2026, "rank")).sortKey);
    assert.notEqual(unpackColumnData(packed(item, 2025)).sortKey, unpackColumnData(packed(item, 2026)).sortKey);
  });

  it("orders CCF T grades before preprint and non-CCF states afterward", () => {
    const states = [
      state({ status: "unknown", rank: undefined }),
      state({ status: "none", rank: undefined }),
      state({ status: "preprint", rank: undefined }),
      state({ rank: "T2" }),
      state({ rank: "T1" }),
    ];
    const sorted = states.map((item) => ({ item, data: packed(item, 2026) })).sort((a, b) => collator.compare(a.data, b.data));
    assert.deepEqual(sorted.map(({ item }) => item.rank || item.status), ["T1", "T2", "preprint", "none", "unknown"]);
  });
});
