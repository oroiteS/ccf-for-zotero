import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  invalidateItemRows,
  refreshAllItemTrees,
  refreshItemsViewAndMaintainSelection,
  setCCFSortColumnKey,
  softRefreshItemsView,
} from "../src/modules/viewRefresh";

function withZoteroItemsView(itemsView: any, callback: () => void) {
  const originalZotero = (globalThis as any).Zotero;
  const originalZtoolkit = (globalThis as any).ztoolkit;
  (globalThis as any).Zotero = {
    getActiveZoteroPane() {
      return { itemsView };
    },
  };
  (globalThis as any).ztoolkit = { log() {} };
  try {
    callback();
  } finally {
    (globalThis as any).Zotero = originalZotero;
    (globalThis as any).ztoolkit = originalZtoolkit;
  }
}

async function withZoteroWindows(
  views: any[],
  callback: () => Promise<void>,
): Promise<void> {
  const originalZotero = (globalThis as any).Zotero;
  const originalZtoolkit = (globalThis as any).ztoolkit;
  (globalThis as any).Zotero = {
    getActiveZoteroPane: () => ({ itemsView: views[0] }),
    getMainWindows: () => views.map((itemsView) => ({ ZoteroPane: { itemsView } })),
  };
  (globalThis as any).ztoolkit = { log() {} };
  try {
    await callback();
  } finally {
    setCCFSortColumnKey(undefined);
    (globalThis as any).Zotero = originalZotero;
    (globalThis as any).ztoolkit = originalZtoolkit;
  }
}

const waitForDebounce = () => new Promise<void>((resolve) => setTimeout(resolve, 350));
const CCF_KEY = "ccfForZoteroRank-ccf-for-zotero@nyaru177.github.io";

describe("Zotero item view refresh helpers", () => {
  it("invalidates specific rows for small target sets", () => {
    const invalidatedRows: number[] = [];
    const itemsView = {
      getRowIndexByID(id: string | number) {
        return String(id) === "42" ? 3 : false;
      },
      tree: {
        invalidateRow(rowIndex: number) {
          invalidatedRows.push(rowIndex);
        },
      },
    };

    withZoteroItemsView(itemsView, () => {
      assert.equal(invalidateItemRows([42]), true);
      assert.deepEqual(invalidatedRows, [3]);
    });
  });

  it("uses visible-row invalidation for large target sets", () => {
    const invalidatedRows: number[] = [];
    let directLookups = 0;
    const targets = Array.from({ length: 500 }, (_, index) => index + 1);
    const visibleRows = [{ id: 101 }, { id: 250 }, { id: 999 }];
    const itemsView = {
      getRow(index: number) {
        return visibleRows[index];
      },
      getRowIndexByID() {
        directLookups += 1;
        return false;
      },
      tree: {
        getFirstVisibleRow() {
          return 0;
        },
        getLastVisibleRow() {
          return visibleRows.length - 1;
        },
        invalidateRow(rowIndex: number) {
          invalidatedRows.push(rowIndex);
        },
        invalidate() {
          throw new Error("visible rows should be enough");
        },
      },
    };

    withZoteroItemsView(itemsView, () => {
      assert.equal(softRefreshItemsView(targets), true);
      assert.deepEqual(invalidatedRows, [0, 1]);
      assert.equal(directLookups, 0);
    });
  });

  it("keeps full refresh as an explicit empty-target fallback", () => {
    let refreshCalls = 0;
    const itemsView = {
      refreshAndMaintainSelection() {
        refreshCalls += 1;
      },
      tree: {
        invalidate() {
          throw new Error("should prefer refreshAndMaintainSelection");
        },
      },
    };

    withZoteroItemsView(itemsView, () => {
      assert.equal(refreshItemsViewAndMaintainSelection(), true);
      assert.equal(refreshCalls, 1);
    });
  });

  it("falls back to whole-tree invalidate when targeted rows are unavailable", () => {
    // 目标行不在当前视图（例如 Connector 保存到其它集合后定向失效失败）
    // 时，必须退化为整树轻量失效，否则行会停留在 Unknown。
    let treeInvalidated = 0;
    const itemsView = {
      getRowIndexByID() {
        return false;
      },
      tree: {
        invalidateRow() {
          throw new Error("row lookup failed, should not be called");
        },
        invalidate() {
          treeInvalidated += 1;
        },
      },
    };

    withZoteroItemsView(itemsView, () => {
      assert.equal(softRefreshItemsView([4242]), true);
      assert.equal(treeInvalidated, 1);
    });
  });

  it("clears the ItemTree row data cache before invalidating rows", () => {
    // 行显示数据（含自定义列 dataProvider 结果）缓存在 itemsView._rowCache，
    // Zotero 只在 item modify/refresh 通知时清除。插件刷新私有缓存后若不
    // 主动清除，invalidateRow 会用旧数据重绘，列停留在 Unknown。
    const rowCache: Record<number, string> = { 42: "Unknown" };
    const invalidatedRows: number[] = [];
    let cacheClearedAll: boolean | undefined;
    const itemsView = {
      getRowIndexByID(id: string | number) {
        return String(id) === "42" ? 3 : false;
      },
      invalidateRowCache(ids: number[] | true) {
        if (ids === true) {
          cacheClearedAll = true;
          return;
        }
        for (const id of ids) delete rowCache[id];
      },
      tree: {
        invalidateRow(rowIndex: number) {
          invalidatedRows.push(rowIndex);
        },
      },
    };

    withZoteroItemsView(itemsView, () => {
      assert.equal(invalidateItemRows([42]), true);
      assert.deepEqual(invalidatedRows, [3]);
      assert.equal(42 in rowCache, false, "row cache entry must be cleared");
      assert.equal(cacheClearedAll, undefined, "targeted path must not clear the whole cache");
    });
  });

  it("falls back to manual _rowCache clearing on Zotero 7 without invalidateRowCache", () => {
    const rowCache: Record<number, string> = { 7: "Unknown" };
    const itemsView = {
      getRowIndexByID(id: string | number) {
        return String(id) === "7" ? 0 : false;
      },
      get _rowCache() {
        return rowCache;
      },
      set _rowCache(value: Record<number, string>) {
        Object.keys(rowCache).forEach((key) => delete rowCache[Number(key)]);
        Object.assign(rowCache, value);
      },
      tree: {
        invalidateRow() {},
      },
    };

    withZoteroItemsView(itemsView, () => {
      assert.equal(invalidateItemRows([7]), true);
      assert.equal(7 in rowCache, false);
    });
  });

  it("sorts only views with the exact registered primary key before invalidation", async () => {
    const events: string[] = [];
    let resolveSort!: () => void;
    const sorted = {
      getSortField: () => CCF_KEY,
      invalidateRowCache: () => events.push("sorted:cache"),
      sort: () => {
        events.push("sorted:sort");
        return new Promise<void>((resolve) => { resolveSort = resolve; });
      },
      tree: { invalidate: () => events.push("sorted:invalidate") },
    };
    const other = {
      getSortField: () => "ccfForZoteroRank",
      invalidateRowCache: () => events.push("other:cache"),
      sort: () => events.push("other:sort"),
      tree: { invalidate: () => events.push("other:invalidate") },
    };
    await withZoteroWindows([sorted, other], async () => {
      setCCFSortColumnKey(CCF_KEY);
      refreshAllItemTrees({ resort: true });
      assert.deepEqual(events, ["sorted:cache", "sorted:sort", "other:cache", "other:invalidate"]);
      resolveSort();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assert.equal(events.at(-1), "sorted:invalidate");
      events.length = 0;
      refreshAllItemTrees();
      assert.deepEqual(events, ["sorted:cache", "sorted:invalidate", "other:cache", "other:invalidate"]);
    });
  });

  it("debounces private-state refreshes across windows and checks the current primary sort", async () => {
    let windowReads = 0;
    const calls: string[] = [];
    let field = CCF_KEY;
    const makeView = (name: string, getSortField: () => string) => ({
      getSortField,
      invalidateRowCache: () => {},
      getRowIndexByID: () => 0,
      sort: () => { calls.push(name); },
      tree: { invalidateRow() {}, invalidate() {} },
    });
    const first = makeView("first", () => field);
    const second = makeView("second", () => CCF_KEY);
    const other = makeView("other", () => "title");
    await withZoteroWindows([first, second, other], async () => {
      const zotero = (globalThis as any).Zotero;
      const getWindows = zotero.getMainWindows;
      zotero.getMainWindows = () => { windowReads++; return getWindows(); };
      setCCFSortColumnKey(CCF_KEY);
      for (let i = 0; i < 1000; i++) {
        assert.equal(softRefreshItemsView([i + 1]), true);
        assert.equal(refreshItemsViewAndMaintainSelection([i + 1]), true);
      }
      assert.equal(windowReads, 0);
      field = "title";
      await waitForDebounce();
      assert.equal(windowReads, 1);
      assert.deepEqual(calls, ["second"]);
    });
  });

  it("queues one further sort when state changes during an in-flight sort", async () => {
    let calls = 0;
    let resolveFirst!: () => void;
    const view = {
      getSortField: () => CCF_KEY,
      invalidateRowCache() {},
      getRowIndexByID: () => 0,
      sort() {
        calls++;
        if (calls === 1) return new Promise<void>((resolve) => { resolveFirst = resolve; });
      },
      tree: { invalidateRow() {}, invalidate() {} },
    };
    await withZoteroWindows([view], async () => {
      setCCFSortColumnKey(CCF_KEY);
      softRefreshItemsView([1]);
      await waitForDebounce();
      softRefreshItemsView([2]);
      softRefreshItemsView([3]);
      await waitForDebounce();
      assert.equal(calls, 1);
      resolveFirst();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assert.equal(calls, 2);
    });
  });

  it("continues refreshing when sort APIs are absent or sorting fails", async () => {
    const invalidated: string[] = [];
    const makeView = (name: string, sort?: () => unknown) => ({
      getSortField: () => CCF_KEY,
      sort,
      tree: { invalidate: () => invalidated.push(name) },
    });
    const views = [
      makeView("missing"),
      makeView("throw", () => { throw new Error("sort failed"); }),
      makeView("reject", () => Promise.reject(new Error("sort rejected"))),
      { tree: { invalidate: () => invalidated.push("no-field") } },
    ];
    await withZoteroWindows(views, async () => {
      setCCFSortColumnKey(CCF_KEY);
      refreshAllItemTrees({ resort: true });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(invalidated.sort(), ["missing", "no-field", "reject", "throw"]);
    });
  });

  it("clears the whole row cache before the whole-tree fallback invalidate", () => {
    let clearedAll = false;
    let treeInvalidated = 0;
    const itemsView = {
      getRowIndexByID() {
        return false;
      },
      invalidateRowCache(ids: number[] | true) {
        if (ids === true) clearedAll = true;
      },
      tree: {
        invalidate() {
          treeInvalidated += 1;
        },
      },
    };

    withZoteroItemsView(itemsView, () => {
      assert.equal(softRefreshItemsView([4242]), true);
      assert.equal(clearedAll, true, "whole-tree fallback must clear the row cache");
      assert.equal(treeInvalidated, 1);
    });
  });
});
