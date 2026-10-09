import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import hooks from "../src/hooks";
import {
  isItemNotifierRegistered,
  registerItemNotifier,
  unregisterItemNotifier,
} from "../src/modules/notifier";
import {
  hasPendingInvalidationRecompute,
  resetInvalidationRecomputeForTest,
  runInvalidationRecomputeNow,
  shutdownInvalidationRecompute,
} from "../src/modules/invalidationRecompute";
import { clearStorageMemoryCache } from "../src/modules/storage";

const ITEM_STATE_KEY = "extensions.ccf-for-zotero.itemState";

interface RegisteredObserver {
  id: number;
  ref: any;
  types: string[];
  name: string;
}

interface NotifierHarness {
  zotero: any;
  prefs: Map<string, string>;
  observers: RegisteredObserver[];
  emit(event: string, type: string, ids: Array<string | number>): void;
}

function makeArxivPreprintItem(id: number): any {
  const fields: Record<string, string> = {
    title: "Instant Personalized Large Language Model Adaptation via Hypernetwork",
    DOI: "10.48550/arXiv.2510.16282",
    url: "http://arxiv.org/abs/2510.16282",
    extra: "arXiv:2510.16282 [cs.CL]",
  };
  return {
    libraryID: 1,
    id,
    itemType: "preprint",
    isRegularItem: () => true,
    getField(field: string) {
      return fields[field] ?? "";
    },
  };
}

function withZoteroNotifierMock(
  items: Record<number, any>,
  callback: (harness: NotifierHarness) => Promise<void>,
) {
  return async () => {
    const prefs = new Map<string, string>();
    const observers: RegisteredObserver[] = [];
    let nextObserverID = 1;
    const harness: NotifierHarness = {
      prefs,
      observers,
      emit(event, type, ids) {
        for (const observer of [...observers]) {
          observer.ref.notify(event, type, ids, {});
        }
      },
      zotero: {
        Notifier: {
          registerObserver(ref: any, types: string[], name: string) {
            const entry = { id: nextObserverID++, ref, types, name };
            observers.push(entry);
            return entry.id;
          },
          unregisterObserver(id: number) {
            const index = observers.findIndex((entry) => entry.id === id);
            if (index >= 0) observers.splice(index, 1);
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
      },
    };

    const originalZotero = (globalThis as any).Zotero;
    const originalZtoolkit = (globalThis as any).ztoolkit;
    (globalThis as any).Zotero = harness.zotero;
    (globalThis as any).ztoolkit = { log() {} };
    try {
      await callback(harness);
    } finally {
      unregisterItemNotifier();
      resetInvalidationRecomputeForTest();
      clearStorageMemoryCache();
      (globalThis as any).Zotero = originalZotero;
      (globalThis as any).ztoolkit = originalZtoolkit;
    }
  };
}

function readItemStateStore(prefs: Map<string, string>): any {
  return JSON.parse(prefs.get(ITEM_STATE_KEY) || "{}");
}

describe("Zotero item notifier wiring", () => {
  after(() => {
    shutdownInvalidationRecompute();
  });

  it(
    "registers once, forwards item add notifications, and stays idempotent",
    withZoteroNotifierMock({ 301: makeArxivPreprintItem(301) }, async (harness) => {
      assert.equal(isItemNotifierRegistered(), false);

      assert.equal(registerItemNotifier(hooks.onNotify), true);
      assert.equal(isItemNotifierRegistered(), true);
      assert.equal(harness.observers.length, 1);
      assert.deepEqual(harness.observers[0].types, ["item"]);

      // 重复注册只更新回调，不产生第二个观察者。
      assert.equal(registerItemNotifier(hooks.onNotify), true);
      assert.equal(harness.observers.length, 1);

      // 模拟 Connector 保存新条目后 Zotero 发出的 add 通知。
      harness.emit("add", "item", [301]);
      assert.equal(hasPendingInvalidationRecompute(), true);

      const result = await runInvalidationRecomputeNow();
      assert.equal(result.skipped, false);
      assert.equal(result.processed, 1);

      const store = readItemStateStore(harness.prefs);
      assert.equal(store.items["1:301"]?.status, "preprint");
      assert.equal(hasPendingInvalidationRecompute(), false);
    }),
  );

  it(
    "ignores non-item types and non add/modify events",
    withZoteroNotifierMock({ 302: makeArxivPreprintItem(302) }, async (harness) => {
      registerItemNotifier(hooks.onNotify);

      harness.emit("add", "collection", [302]);
      harness.emit("delete", "item", [302]);
      harness.emit("trash", "item", [302]);
      assert.equal(hasPendingInvalidationRecompute(), false);
    }),
  );

  it(
    "invalidates and recomputes cached items on modify notifications",
    withZoteroNotifierMock({ 303: makeArxivPreprintItem(303) }, async (harness) => {
      registerItemNotifier(hooks.onNotify);

      harness.emit("add", "item", [303]);
      await runInvalidationRecomputeNow();
      const storeAfterAdd = readItemStateStore(harness.prefs);
      assert.equal(storeAfterAdd.items["1:303"]?.status, "preprint");

      // modify 通知应失效缓存并重新排队重算。
      harness.emit("modify", "item", [303]);
      assert.equal(hasPendingInvalidationRecompute(), true);
      const result = await runInvalidationRecomputeNow();
      assert.equal(result.processed, 1);
    }),
  );

  it(
    "stops forwarding notifications after unregistering",
    withZoteroNotifierMock({ 304: makeArxivPreprintItem(304) }, async (harness) => {
      registerItemNotifier(hooks.onNotify);
      unregisterItemNotifier();

      assert.equal(isItemNotifierRegistered(), false);
      assert.equal(harness.observers.length, 0);

      harness.emit("add", "item", [304]);
      assert.equal(hasPendingInvalidationRecompute(), false);
    }),
  );
});
