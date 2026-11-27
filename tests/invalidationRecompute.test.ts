import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  hasPendingInvalidationRecompute,
  queueInvalidationRecompute,
  queueStaleRecompute,
  resetInvalidationRecomputeForTest,
  runInvalidationRecomputeNow,
  shutdownInvalidationRecompute,
} from "../src/modules/invalidationRecompute";
import { getCatalogVersion, getMatcherVersion } from "../src/modules/matcher";
import { refreshItemRank } from "../src/modules/rankService";
import {
  clearItemState,
  clearStorageMemoryCache,
  getStoredState,
  ignoreItem,
  invalidateItemStates,
  saveManualMatch,
} from "../src/modules/storage";
import { ITEM_STATE_VERSION } from "../src/modules/types";

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

  it("queues stale catalog/matcher items without resetting debounce on duplicates and preserves manual entries", async () => {
    const prefs = new Map<string, string>();
    const staleCatalogItem: any = {
      libraryID: 1,
      id: 301,
      itemType: "journalArticle",
      isRegularItem: () => true,
      getField: (field: string) =>
        field === "publicationTitle" ? "Proceedings of the IEEE" : "",
    };
    const staleMatcherItem: any = {
      libraryID: 1,
      id: 302,
      itemType: "conferencePaper",
      isRegularItem: () => true,
      getField: (field: string) =>
        field === "proceedingsTitle" ? "EMNLP 2025" : "",
    };
    const manualItem: any = {
      libraryID: 1,
      id: 303,
      itemType: "conferencePaper",
      isRegularItem: () => true,
      getField: () => "",
    };
    prefs.set(
      ITEM_STATE_KEY,
      JSON.stringify({
        version: 1,
        items: {
          "1:301": {
            itemKey: "1:301",
            status: "none",
            source: "auto",
            venueText: "Proceedings of the IEEE",
            stateVersion: ITEM_STATE_VERSION,
            catalogVersion: "CCF-2026-v7-pdf-audited+old",
            matcherVersion: getMatcherVersion(),
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
          "1:302": {
            itemKey: "1:302",
            status: "matched",
            source: "auto",
            rank: "B",
            abbr: "EMNLP",
            stateVersion: ITEM_STATE_VERSION,
            catalogVersion: getCatalogVersion(),
            matcherVersion: "0.1.18-old",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
          "1:303": {
            itemKey: "1:303",
            status: "matched",
            source: "manual",
            rank: "A",
            abbr: "ACL",
            stateVersion: ITEM_STATE_VERSION,
            catalogVersion: "CCF-2026-v7-pdf-audited+old",
            matcherVersion: "0.1.18-old",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        },
      }),
    );

    const items: Record<number, any> = {
      301: staleCatalogItem,
      302: staleMatcherItem,
      303: manualItem,
    };
    let timerSchedules = 0;
    const fakeWin = {
      setTimeout(fn: () => void, ms: number) {
        if (ms === 0) {
          return setTimeout(fn, 0);
        }
        timerSchedules += 1;
        return timerSchedules;
      },
      clearTimeout(handle: unknown) {
        if (typeof handle !== "number") clearTimeout(handle as any);
      },
    };

    const originalZotero = (globalThis as any).Zotero;
    const originalZtoolkit = (globalThis as any).ztoolkit;
    (globalThis as any).Zotero = {
      Items: {
        get(id: number | string) {
          return items[Number(id)] ?? false;
        },
      },
      getMainWindows: () => [fakeWin],
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

      queueStaleRecompute([301, 302, 303]);
      assert.equal(timerSchedules, 1);
      // 重复排队相同条目不应重置防抖定时器。
      queueStaleRecompute([301, 302]);
      assert.equal(timerSchedules, 1);

      const result = await runInvalidationRecomputeNow();
      assert.equal(result.skipped, false);
      assert.equal(result.ccfItems, 2);

      const store = JSON.parse(prefs.get(ITEM_STATE_KEY) || "{}");
      assert.equal(store.items["1:301"].status, "matched");
      assert.equal(store.items["1:301"].rank, "A");
      assert.equal(store.items["1:301"].abbr, "Proc. IEEE");
      assert.equal(store.items["1:301"].catalogVersion, getCatalogVersion());
      assert.equal(store.items["1:302"].matcherVersion, getMatcherVersion());
      assert.equal(store.items["1:303"].source, "manual");
      assert.equal(store.items["1:303"].abbr, "ACL");
    } finally {
      clearStorageMemoryCache();
      resetInvalidationRecomputeForTest();
      (globalThis as any).Zotero = originalZotero;
      (globalThis as any).ztoolkit = originalZtoolkit;
    }
  });

  it("preserves items marked manual or ignored mid-batch and still allows restoring automatic matching", async () => {
    const prefs = new Map<string, string>();
    let setCalls = 0;
    const item401: any = {
      libraryID: 1,
      id: 401,
      itemType: "conferencePaper",
      isRegularItem: () => true,
      getField: (field: string) => (field === "proceedingsTitle" ? "EMNLP 2025" : ""),
    };
    const item402: any = {
      libraryID: 1,
      id: 402,
      itemType: "conferencePaper",
      isRegularItem: () => true,
      getField: (field: string) => (field === "proceedingsTitle" ? "EMNLP 2025" : ""),
    };
    const item403: any = {
      libraryID: 1,
      id: 403,
      itemType: "conferencePaper",
      isRegularItem: () => true,
      getField: (field: string) => (field === "proceedingsTitle" ? "EMNLP 2025" : ""),
    };

    const items: Record<number, any> = { 401: item401, 402: item402, 403: item403 };
    let yieldCount = 0;
    const fakeWin = {
      setTimeout(fn: () => void, ms: number) {
        if (ms === 0) {
          yieldCount += 1;
          if (yieldCount === 1) {
            // 批处理中途（401 已计算并进入 pendingSave，尚未落盘）用户标记忽略与手动设置。
            ignoreItem(item401);
            saveManualMatch(item402, {
              status: "matched",
              source: "manual",
              rank: "A",
              abbr: "ACL",
              fullName: "Annual Meeting of the Association for Computational Linguistics",
              confidence: 1,
              matchMethod: "manual",
            });
          }
          return setTimeout(fn, 0);
        }
        return 1;
      },
      clearTimeout(handle: unknown) {
        if (typeof handle !== "number") clearTimeout(handle as any);
      },
    };

    const originalZotero = (globalThis as any).Zotero;
    const originalZtoolkit = (globalThis as any).ztoolkit;
    (globalThis as any).Zotero = {
      Items: { get: (id: number | string) => items[Number(id)] ?? false },
      getMainWindows: () => [fakeWin],
      Prefs: {
        get: (key: string) => (prefs.has(key) ? prefs.get(key) : ""),
        set: (key: string, value: string) => {
          setCalls += 1;
          prefs.set(key, value);
        },
        clear: (key: string) => prefs.delete(key),
      },
    };
    (globalThis as any).ztoolkit = { log() {} };

    try {
      clearStorageMemoryCache();
      resetInvalidationRecomputeForTest();

      queueInvalidationRecompute([401, 402, 403]);
      await runInvalidationRecomputeNow();

      const store = JSON.parse(prefs.get(ITEM_STATE_KEY) || "{}");
      assert.equal(store.items["1:401"].status, "ignored");
      assert.equal(store.items["1:401"].source, "manual");
      assert.equal(store.items["1:402"].status, "matched");
      assert.equal(store.items["1:402"].source, "manual");
      assert.equal(store.items["1:402"].abbr, "ACL");
      assert.equal(store.items["1:403"].status, "matched");
      assert.equal(store.items["1:403"].source, "auto");
      assert.equal(store.items["1:403"].abbr, "EMNLP");

      // 对全部被跳过的条目调用 refreshItemRank 不应写入存储。
      const setCallsBeforeSkip = setCalls;
      refreshItemRank(item401);
      assert.equal(setCalls, setCallsBeforeSkip);

      // 显式“恢复自动匹配”先清掉手动状态再重算，应正常恢复为自动结果。
      clearItemState(item401);
      refreshItemRank(item401);
      assert.equal(getStoredState(item401)?.source, "auto");
      assert.equal(getStoredState(item401)?.abbr, "EMNLP");
    } finally {
      clearStorageMemoryCache();
      resetInvalidationRecomputeForTest();
      (globalThis as any).Zotero = originalZotero;
      (globalThis as any).ztoolkit = originalZtoolkit;
    }
  });

  it("discards stale buffered results when an item is edited mid-flight and recomputes on retry", async () => {
    const prefs = new Map<string, string>();
    let setCalls = 0;
    let venue = "EMNLP 2025";
    const editedItem: any = {
      libraryID: 1,
      id: 501,
      itemType: "conferencePaper",
      isRegularItem: () => true,
      getField: (field: string) => (field === "proceedingsTitle" ? venue : ""),
    };

    const items: Record<number, any> = { 501: editedItem };
    let yieldCount = 0;
    const fakeWin = {
      setTimeout(fn: () => void, ms: number) {
        if (ms === 0) {
          yieldCount += 1;
          if (yieldCount === 1) {
            // 501 已按 EMNLP 计算并缓存在 pendingSave，但尚未提交落盘；
            // 此时用户把它改成了 ACL，并触发 modify 失效通知与重算排队。
            venue = "ACL 2026";
            invalidateItemStates([501]);
            queueInvalidationRecompute([501]);
          }
          return setTimeout(fn, 0);
        }
        return 1;
      },
      clearTimeout(handle: unknown) {
        if (typeof handle !== "number") clearTimeout(handle as any);
      },
    };

    const originalZotero = (globalThis as any).Zotero;
    const originalZtoolkit = (globalThis as any).ztoolkit;
    (globalThis as any).Zotero = {
      Items: { get: (id: number | string) => items[Number(id)] ?? false },
      getMainWindows: () => [fakeWin],
      Prefs: {
        get: (key: string) => (prefs.has(key) ? prefs.get(key) : ""),
        set: (key: string, value: string) => {
          setCalls += 1;
          prefs.set(key, value);
        },
        clear: (key: string) => prefs.delete(key),
      },
    };
    (globalThis as any).ztoolkit = { log() {} };

    try {
      clearStorageMemoryCache();
      resetInvalidationRecomputeForTest();

      queueInvalidationRecompute([501]);
      const firstRun = await runInvalidationRecomputeNow();
      assert.equal(firstRun.ccfItems, 1);
      // 过时的 EMNLP 结果必须被丢弃，也不应触发无意义的 saveStore 写盘。
      assert.equal(setCalls, 0);
      assert.equal(prefs.get(ITEM_STATE_KEY), undefined);
      assert.equal(getStoredState(editedItem), undefined);
      assert.equal(hasPendingInvalidationRecompute(), true);

      // 下一轮重试必须重新识别 1 个 CCF 条目并落盘为 ACL。
      const retryRun = await runInvalidationRecomputeNow();
      assert.equal(retryRun.skipped, false);
      assert.equal(retryRun.ccfItems, 1);
      assert.equal(setCalls, 1);

      const stored = getStoredState(editedItem);
      assert.equal(stored?.status, "matched");
      assert.equal(stored?.rank, "A");
      assert.equal(stored?.abbr, "ACL");
    } finally {
      clearStorageMemoryCache();
      resetInvalidationRecomputeForTest();
      (globalThis as any).Zotero = originalZotero;
      (globalThis as any).ztoolkit = originalZtoolkit;
    }
  });

  it("keeps a single outstanding passive timer across distinct queueStaleRecompute calls without cancelling", async () => {
    const prefs = new Map<string, string>();
    const items: Record<number, any> = {
      601: makeRegularItem(601),
      602: makeRegularItem(602),
      603: makeRegularItem(603),
      604: makeRegularItem(604),
    };

    let timerSchedules = 0;
    let timerClears = 0;
    let nextTimerID = 1;
    const fakeWin = {
      setTimeout(fn: () => void, ms: number) {
        if (ms === 0) return setTimeout(fn, 0);
        timerSchedules += 1;
        return nextTimerID++;
      },
      clearTimeout(handle: unknown) {
        if (typeof handle === "number") {
          timerClears += 1;
        } else {
          clearTimeout(handle as any);
        }
      },
    };

    const originalZotero = (globalThis as any).Zotero;
    const originalZtoolkit = (globalThis as any).ztoolkit;
    (globalThis as any).Zotero = {
      Items: { get: (id: number | string) => items[Number(id)] ?? false },
      getMainWindows: () => [fakeWin],
      Prefs: {
        get: (key: string) => (prefs.has(key) ? prefs.get(key) : ""),
        set: (key: string, value: string) => prefs.set(key, value),
        clear: (key: string) => prefs.delete(key),
      },
    };
    (globalThis as any).ztoolkit = { log() {} };

    try {
      clearStorageMemoryCache();
      resetInvalidationRecomputeForTest();

      queueStaleRecompute([601]);
      queueStaleRecompute([602]);
      queueStaleRecompute([603]);

      assert.equal(timerSchedules, 1);
      assert.equal(timerClears, 0);

      // 主动编辑通知（queueInvalidationRecompute）仍保持防抖重置行为。
      queueInvalidationRecompute([604]);
      assert.equal(timerClears, 1);
      assert.equal(timerSchedules, 2);

      const result = await runInvalidationRecomputeNow();
      assert.equal(result.ccfItems, 4);
    } finally {
      clearStorageMemoryCache();
      resetInvalidationRecomputeForTest();
      (globalThis as any).Zotero = originalZotero;
      (globalThis as any).ztoolkit = originalZtoolkit;
    }
  });
});
