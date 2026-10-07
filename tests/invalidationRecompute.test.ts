import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  hasPendingInvalidationRecompute,
  queueInvalidationRecompute,
  resetInvalidationRecomputeForTest,
  runInvalidationRecomputeNow,
  shutdownInvalidationRecompute,
} from "../src/modules/invalidationRecompute";

const ITEM_STATE_KEY = "extensions.ccf-for-zotero.itemState";

function makeRegularItem(id: number): any {
  return {
    libraryID: 1,
    id,
    itemType: "journalArticle",
    isRegularItem: () => true,
    getField: () => "",
  };
}

function makeAttachmentItem(id: number): any {
  return {
    libraryID: 1,
    id,
    itemType: "attachment",
    isRegularItem: () => false,
    getField: () => "",
  };
}

function withZoteroMock(
  items: Record<number, any>,
  callback: () => Promise<void>,
) {
  return async () => {
    const prefs = new Map<string, string>();
    const originalZotero = (globalThis as any).Zotero;
    const originalZtoolkit = (globalThis as any).ztoolkit;
    (globalThis as any).Zotero = {
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
      await callback();
    } finally {
      resetInvalidationRecomputeForTest();
      (globalThis as any).Zotero = originalZotero;
      (globalThis as any).ztoolkit = originalZtoolkit;
    }
  };
}

describe("CCF/CAS invalidation recompute queue", () => {
  after(() => {
    resetInvalidationRecomputeForTest();
  });

  it(
    "recomputes queued regular items and skips deleted/attachment ids",
    withZoteroMock(
      {
        101: makeRegularItem(101),
        102: makeRegularItem(102),
        103: false, // 已删除
        104: makeAttachmentItem(104),
      },
      async () => {
        queueInvalidationRecompute([101, "102", 103, 104]);
        assert.equal(hasPendingInvalidationRecompute(), true);

        const result = await runInvalidationRecomputeNow();
        assert.equal(result.skipped, false);
        assert.equal(result.ccfItems, 2);
        assert.equal(result.processed, 2);

        assert.equal(hasPendingInvalidationRecompute(), false);

        const store = JSON.parse(
          (globalThis as any).Zotero.Prefs.get(ITEM_STATE_KEY) || "{}",
        );
        assert.ok(store.items["1:101"]);
        assert.ok(store.items["1:102"]);
        assert.equal(store.items["1:104"], undefined);
      },
    ),
  );

  it(
    "returns an empty result when nothing is queued",
    withZoteroMock({}, async () => {
      const result = await runInvalidationRecomputeNow();
      assert.equal(result.processed, 0);
      assert.equal(result.skipped, false);
      assert.equal(hasPendingInvalidationRecompute(), false);
    }),
  );

  it(
    "drops the pending queue on shutdown",
    withZoteroMock({ 201: makeRegularItem(201) }, async () => {
      queueInvalidationRecompute([201]);
      assert.equal(hasPendingInvalidationRecompute(), true);

      shutdownInvalidationRecompute();
      assert.equal(hasPendingInvalidationRecompute(), false);

      const result = await runInvalidationRecomputeNow();
      assert.equal(result.processed, 0);
    }),
  );
});
