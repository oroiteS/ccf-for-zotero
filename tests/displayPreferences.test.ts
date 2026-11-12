import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatColumnDataForState, unpackColumnData } from "../src/modules/column";
import { formatItemDiagnostics } from "../src/modules/diagnostics";
import {
  CCF_DISPLAY_STYLE_KEY,
  getCCFDisplayStyle,
  setCCFDisplayStyle,
} from "../src/modules/displayPreferences";
import { attachInitializationPreferences } from "../src/modules/preferences";

describe("CCF display style setting", () => {
  it("persists the selection, refreshes every window, and restores it on reopen", () => {
    const oldZotero = (globalThis as any).Zotero;
    const oldToolkit = (globalThis as any).ztoolkit;
    const prefs = new Map<string, string>();
    const calls: string[] = [];
    let failWrite = false;
    const view = (name: string) => ({
      invalidateRowCache(value: boolean) { calls.push(`${name}:cache:${value}`); },
      tree: { invalidate() { calls.push(`${name}:redraw`); } },
    });
    const first = view("first");
    const second = view("second");
    (globalThis as any).ztoolkit = { log() {} };
    (globalThis as any).Zotero = {
      Prefs: {
        get(key: string, global: boolean) { assert.equal(global, true); return prefs.get(key); },
        set(key: string, value: string, global: boolean) {
          assert.equal(global, true);
          if (failWrite) throw new Error("write failed");
          prefs.set(key, value);
        },
      },
      getMainWindows() { return [{ ZoteroPane: { itemsView: first } }, { ZoteroPane: { itemsView: second } }]; },
      getActiveZoteroPane() { return { itemsView: first }; },
    };
    function makeRadio(value: string) {
      const listeners = new Map<string, (event: any) => void>();
      return {
        value, checked: false, listeners,
        addEventListener(type: string, fn: (event: any) => void) { listeners.set(type, fn); },
        removeEventListener(type: string) { listeners.delete(type); },
        change() { listeners.get("change")?.({ currentTarget: this }); },
      };
    }
    const classic = makeRadio("classic");
    const compact = makeRadio("compact");
    const validation = { textContent: "" };
    const root = { querySelector(selector: string) {
      if (selector === "#ccf-display-classic") return classic;
      if (selector === "#ccf-display-compact") return compact;
      if (selector === "#ccf-display-validation") return validation;
      return null;
    } };
    const win = { addEventListener() {}, removeEventListener() {} };
    try {
      assert.equal(getCCFDisplayStyle(), "classic");
      const cleanup = attachInitializationPreferences(win as any, root as any);
      assert.equal(classic.checked, true);
      assert.equal(compact.checked, false);
      classic.checked = false;
      compact.checked = true;
      compact.change();
      assert.equal(prefs.get(CCF_DISPLAY_STYLE_KEY), "compact");
      assert.equal(getCCFDisplayStyle(), "compact");
      assert.deepEqual(calls, ["first:cache:true", "first:redraw", "second:cache:true", "second:redraw"]);
      cleanup();
      assert.equal(classic.listeners.has("change"), false);
      assert.equal(compact.listeners.has("change"), false);
      classic.checked = false;
      compact.checked = false;
      const cleanupAgain = attachInitializationPreferences(win as any, root as any);
      assert.equal(classic.checked, false);
      assert.equal(compact.checked, true);
      compact.checked = false;
      classic.checked = true;
      classic.change();
      assert.equal(getCCFDisplayStyle(), "classic");
      assert.equal(prefs.get(CCF_DISPLAY_STYLE_KEY), "classic");
      failWrite = true;
      classic.checked = false;
      compact.checked = true;
      compact.change();
      assert.equal(classic.checked, true);
      assert.equal(compact.checked, false);
      assert.match(validation.textContent, /保存显示设置失败/);
      failWrite = false;
      cleanupAgain();
      setCCFDisplayStyle("classic");
      assert.equal(getCCFDisplayStyle(), "classic");
      prefs.set(CCF_DISPLAY_STYLE_KEY, "invalid");
      assert.equal(getCCFDisplayStyle(), "classic");
    } finally {
      (globalThis as any).Zotero = oldZotero;
      (globalThis as any).ztoolkit = oldToolkit;
    }
  });

  it("uses the selected compact format in diagnostics as well as the column", () => {
    const oldZotero = (globalThis as any).Zotero;
    (globalThis as any).Zotero = { Prefs: { get() { return "compact"; } } };
    try {
      const item = {
        itemType: "preprint",
        getField(field: string) {
          return ({ archiveID: "arXiv:2701.12345", date: "2027-01-10" } as Record<string, string>)[field] || "";
        },
      } as unknown as Zotero.Item;
      assert.match(formatItemDiagnostics(item), /结果：arXiv 2027/);
      const state = { itemKey: "1:1", status: "matched" as const, source: "auto" as const, rank: "A" as const, abbr: "AAAI", updatedAt: "" };
      assert.equal(unpackColumnData(formatColumnDataForState(state, { year: 2027, style: getCCFDisplayStyle() })).display, "A|AAAI 2027");
    } finally {
      (globalThis as any).Zotero = oldZotero;
    }
  });
});
