import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  invalidateItemRows,
  refreshItemsViewAndMaintainSelection,
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
