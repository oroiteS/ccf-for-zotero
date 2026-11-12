import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerRightClickMenu, registerToolsMenu } from "../src/modules/menu";
import { attachInitializationPreferences } from "../src/modules/preferences";
import { getRecognitionProjects, RECOGNITION_PROJECTS_KEY } from "../src/modules/projectPreferences";

class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  listeners = new Map<string, (event: any) => void>();
  checked = false;
  textContent = "";
  constructor(public tag = "") {}
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  addEventListener(name: string, fn: (event: any) => void) { this.listeners.set(name, fn); }
  removeEventListener(name: string) { this.listeners.delete(name); }
  get parentNode() { return this.parentElement; }
  appendChild(child: FakeElement) { child.parentElement = this; this.children.push(child); return child; }
  replaceChild(child: FakeElement, old: FakeElement) {
    const index = this.children.indexOf(old);
    assert.notEqual(index, -1);
    this.children[index] = child;
    old.parentElement = null;
    child.parentElement = this;
    return old;
  }
  dispatch(name: string) { this.listeners.get(name)?.({ target: this, currentTarget: this }); }
}

describe("recognition project preferences", () => {
  it("migrates the last initialization choice, persists edits and updates both menus", () => {
    const oldZotero = (globalThis as any).Zotero;
    const oldToolkit = (globalThis as any).ztoolkit;
    const prefs = new Map<string, string>([[
      "extensions.ccf-for-zotero.initializationState",
      JSON.stringify({ lastProjects: ["CCF"] }),
    ]]);
    (globalThis as any).ztoolkit = { log() {} };
    (globalThis as any).Zotero = { Prefs: {
      get(key: string) { return prefs.get(key); },
      set(key: string, value: string) { prefs.set(key, value); },
    } };
    const ccf = new FakeElement("input");
    const cas = new FakeElement("input");
    const validation = new FakeElement("p");
    const root = { querySelector(id: string) {
      return ({ "#ccf-init-ccf": ccf, "#ccf-init-cas": cas, "#ccf-projects-validation": validation } as Record<string, FakeElement>)[id] || null;
    } };
    const win = { addEventListener() {}, removeEventListener() {} };
    try {
      assert.deepEqual(getRecognitionProjects(), { includeCCF: true, includeCAS: false });
      const cleanup = attachInitializationPreferences(win as any, root as any);
      assert.equal(ccf.checked, true);
      assert.equal(cas.checked, false);

      const itemMenu = new FakeElement("menupopup");
      const toolsMenu = new FakeElement("menupopup");
      const doc = {
        createXULElement(tag: string) { return new FakeElement(tag); },
        getElementById(id: string) { return id === "zotero-itemmenu" ? itemMenu : id === "menu_ToolsPopup" ? toolsMenu : null; },
      };
      const unloadHandlers: Array<() => void> = [];
      const mainWin = { document: doc, addEventListener(type: string, fn: () => void) {
        if (type === "unload") unloadHandlers.push(fn);
      } } as any;
      registerRightClickMenu(mainWin);
      registerToolsMenu(mainWin);
      function verify(includeCCF: boolean, includeCAS: boolean) {
        for (const menu of [itemMenu, toolsMenu]) {
          assert.equal(menu.children.length, 1, "menu root is replaced, not duplicated");
          const popup = menu.children[0].children[0];
          const labels = popup.children.map((child) => child.attributes.get("label"));
          assert.deepEqual(labels, [
            "初始化与后台任务",
            ...(includeCCF ? ["CCF 分级"] : []),
            ...(includeCAS ? ["CAS 中科院分区"] : []),
          ]);
        }
      }
      verify(true, false);
      cas.checked = true;
      cas.dispatch("change");
      assert.deepEqual(JSON.parse(prefs.get(RECOGNITION_PROJECTS_KEY)!), { includeCCF: true, includeCAS: true });
      verify(true, true);
      ccf.checked = false;
      ccf.dispatch("change");
      verify(false, true);
      cas.checked = false;
      cas.dispatch("change");
      verify(false, false);
      cleanup();
      assert.equal(cas.listeners.has("change"), false);
      ccf.checked = true;
      cas.checked = true;
      const again = attachInitializationPreferences(win as any, root as any);
      assert.equal(ccf.checked, false);
      assert.equal(cas.checked, false);
      again();
      for (const unload of unloadHandlers) unload();
    } finally {
      (globalThis as any).Zotero = oldZotero;
      (globalThis as any).ztoolkit = oldToolkit;
    }
  });

  it("defaults to both projects when no settings exist", () => {
    const oldZotero = (globalThis as any).Zotero;
    (globalThis as any).Zotero = { Prefs: { get() { return ""; } } };
    try {
      assert.deepEqual(getRecognitionProjects(), { includeCCF: true, includeCAS: true });
    } finally {
      (globalThis as any).Zotero = oldZotero;
    }
  });
});
