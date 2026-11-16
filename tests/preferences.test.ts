import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CCF_SORT_MODE_KEY } from "../src/modules/sortPreferences";
import {
  attachInitializationPreferences,
  getInitializationScopeLabel,
  normalizeInitializationScope,
  resolveInitializationPreferencesAPI,
  getPreferencePaneOptions,
  PREFERENCE_PANE_ID,
} from "../src/modules/preferences";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("CCF/CAS initialization preference pane", () => {
  it("builds a stable Zotero 10 preference pane option", () => {
    const options = getPreferencePaneOptions();
    assert.equal(options.id, PREFERENCE_PANE_ID);
    assert.equal(options.pluginID, "ccf-for-zotero@nyaru177.github.io");
    assert.equal(options.src, "chrome://ccf-for-zotero/content/preferences.xhtml");
    assert.deepEqual(options.stylesheets, [
      "chrome://ccf-for-zotero/content/preferences.css",
    ]);
    assert.equal(options.defaultXUL, true);
  });

  it("contains stable HTML controls for initialization", () => {
    const markup = readFileSync(
      resolve(projectRoot, "addon/content/preferences.xhtml"),
      "utf8",
    );
    assert.match(markup, /ccf-init-scope/);
    assert.match(markup, /ccf-init-ccf/);
    assert.match(markup, /ccf-init-cas/);
    assert.match(markup, /ccf-init-mode/);
    assert.match(markup, /value="pending-only"/);
    assert.match(markup, /ccf-init-start/);
    assert.match(markup, /ccf-init-cancel/);
    assert.match(markup, /onPrefsEvent\('load'/);
    assert.match(markup, /html:input/);
    assert.match(markup, /html:select/);
  });

  it("presents both display styles as an accessible radio group", () => {
    const markup = readFileSync(resolve(projectRoot, "addon/content/preferences.xhtml"), "utf8");
    assert.match(markup, /role="radiogroup" aria-labelledby="ccf-display-style-label"/);
    assert.match(markup, /id="ccf-display-classic"[^>]*type="radio"[^>]*name="ccf-display-style"[^>]*value="classic"/);
    assert.match(markup, /id="ccf-display-compact"[^>]*type="radio"[^>]*name="ccf-display-style"[^>]*value="compact"/);
    assert.doesNotMatch(markup, /<html:select id="ccf-display-style"/);
  });

  it("presents the sort modes and explains how to use them", () => {
    const markup = readFileSync(resolve(projectRoot, "addon/content/preferences.xhtml"), "utf8");
    assert.match(markup, /role="radiogroup" aria-labelledby="ccf-sort-mode-label" aria-describedby="ccf-sort-hint"/);
    assert.match(markup, /id="ccf-sort-rank"[^>]*type="radio"[^>]*name="ccf-sort-mode"[^>]*value="rank"[^>]*checked="checked"/);
    assert.match(markup, /id="ccf-sort-year"[^>]*type="radio"[^>]*name="ccf-sort-mode"[^>]*value="year"/);
    assert.match(markup, /等级优先（原有排序）/);
    assert.match(markup, /年份优先（新到旧，同年按等级）/);
    assert.match(markup, /点击文献列表的 CCF 列进行排序/);
    assert.match(markup, /年份与 CCF 列展示规则一致/);
    assert.match(markup, /反向排序会同时反转年份与等级/);
  });

  it("restores, persists and cleans up sort mode controls, including failed writes", () => {
    const oldZotero = (globalThis as any).Zotero;
    const oldToolkit = (globalThis as any).ztoolkit;
    const prefs = new Map<string, string>();
    let failWrite = false;
    let writes = 0;
    (globalThis as any).ztoolkit = { log() {} };
    (globalThis as any).Zotero = {
      Prefs: {
        get(key: string, global: boolean) {
          assert.equal(global, true);
          return prefs.get(key);
        },
        set(key: string, value: string, global: boolean) {
          assert.equal(global, true);
          if (key === CCF_SORT_MODE_KEY) {
            writes++;
            if (failWrite) throw new Error("write failed");
          }
          prefs.set(key, value);
        },
      },
      getMainWindows() { return []; },
    };
    function makeRadio(value: string) {
      const listeners = new Map<string, (event: any) => void>();
      return {
        value, checked: false, listeners,
        addEventListener(type: string, fn: (event: any) => void) { listeners.set(type, fn); },
        removeEventListener(type: string, fn: (event: any) => void) {
          if (listeners.get(type) === fn) listeners.delete(type);
        },
        change() { listeners.get("change")?.({ currentTarget: this }); },
      };
    }
    const rank = makeRadio("rank");
    const year = makeRadio("year");
    const validation = { textContent: "" };
    const root = { querySelector(selector: string) {
      return ({ "#ccf-sort-rank": rank, "#ccf-sort-year": year, "#ccf-sort-validation": validation } as Record<string, any>)[selector] || null;
    } };
    const windowListeners = new Map<string, () => void>();
    const win = {
      addEventListener(type: string, fn: () => void) { windowListeners.set(type, fn); },
      removeEventListener(type: string, fn: () => void) {
        if (windowListeners.get(type) === fn) windowListeners.delete(type);
      },
    };
    let cleanup: (() => void) | undefined;
    try {
      cleanup = attachInitializationPreferences(win as any, root as any);
      assert.equal(rank.checked, true, "unset mode defaults to rank");
      assert.equal(year.checked, false);
      rank.checked = false;
      year.checked = true;
      year.change();
      assert.equal(prefs.get(CCF_SORT_MODE_KEY), "year");
      assert.equal(validation.textContent, "");

      cleanup();
      rank.checked = false;
      year.checked = false;
      cleanup = attachInitializationPreferences(win as any, root as any);
      assert.equal(rank.checked, false);
      assert.equal(year.checked, true, "saved mode is restored on reopen");
      failWrite = true;
      rank.checked = true;
      year.checked = false;
      rank.change();
      assert.equal(prefs.get(CCF_SORT_MODE_KEY), "year");
      assert.equal(rank.checked, false);
      assert.equal(year.checked, true);
      assert.match(validation.textContent, /保存排序设置失败/);

      failWrite = false;
      rank.checked = true;
      year.checked = false;
      rank.change();
      assert.equal(prefs.get(CCF_SORT_MODE_KEY), "rank");
      assert.equal(validation.textContent, "");
      assert.ok(windowListeners.has("unload"), "unload is registered even when initialization API is unavailable");
      windowListeners.get("unload")?.();
      assert.equal(windowListeners.has("unload"), false);
      assert.equal(rank.listeners.has("change"), false);
      assert.equal(year.listeners.has("change"), false);
      const writesAfterUnload = writes;
      year.checked = true;
      year.change();
      assert.equal(writes, writesAfterUnload);
      assert.equal(prefs.get(CCF_SORT_MODE_KEY), "rank");
    } finally {
      cleanup?.();
      (globalThis as any).Zotero = oldZotero;
      (globalThis as any).ztoolkit = oldToolkit;
    }
  });

  it("uses the Zotero-generated pane heading without duplicating it in the document", () => {
    const markup = readFileSync(
      resolve(projectRoot, "addon/content/preferences.xhtml"),
      "utf8",
    );
    assert.doesNotMatch(markup, /class="ccf-title"/);
    assert.equal((markup.match(/CCF\/CAS 分级助手/g) || []).length, 0);
  });

  it("registers plugin icons in the add-on manifest", () => {
    const manifest = readFileSync(
      resolve(projectRoot, "addon/manifest.json"),
      "utf8",
    );
    assert.match(manifest, /"icons"/);
    assert.match(manifest, /content\/icons\/ccf-cas-48\.png/);
    assert.match(manifest, /content\/icons\/ccf-cas-96\.png/);
  });

  it("keeps a compact settings pane root without a duplicate title style", () => {
    const stylesheet = readFileSync(
      resolve(projectRoot, "addon/content/preferences.css"),
      "utf8",
    );
    assert.doesNotMatch(stylesheet, /\.ccf-title/);
    assert.match(stylesheet, /#ccf-init-root\.ccf-preferences/);
  });

  it("keeps the stage label readable when detail text is long", () => {
    const stylesheet = readFileSync(
      resolve(projectRoot, "addon/content/preferences.css"),
      "utf8",
    );
    assert.match(
      stylesheet,
      /#ccf-init-root #ccf-init-stage\s*\{[\s\S]*min-width:\s*max-content/,
    );
    assert.match(
      stylesheet,
      /#ccf-init-root \.ccf-detail\s*\{[\s\S]*min-width:\s*0[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis/,
    );
  });

  it("does not add a missing localization resource to the shared preferences document", () => {
    const markup = readFileSync(
      resolve(projectRoot, "addon/content/preferences.xhtml"),
      "utf8",
    );
    assert.doesNotMatch(markup, /<linkset>/);
    assert.doesNotMatch(markup, /__addonRef__-preferences\.ftl/);
  });

  it("scopes preference styles to the plugin pane root", () => {
    const stylesheet = readFileSync(
      resolve(projectRoot, "addon/content/preferences.css"),
      "utf8",
    );
    for (const selector of [
      ".ccf-section",
      ".ccf-field",
      ".ccf-select",
      ".ccf-check",
      ".ccf-button",
      ".ccf-progress",
    ]) {
      assert.match(
        stylesheet,
        new RegExp(`#ccf-init-root(?:\\.ccf-preferences)?[^{}]*${selector.replace(".", "\\.")}`),
        `expected ${selector} to be scoped to #ccf-init-root`,
      );
    }
  });

  it("registers a Zotero preference pane", () => {
    const source = readFileSync(
      resolve(projectRoot, "src/modules/preferences.ts"),
      "utf8",
    );
    assert.match(source, /Zotero\.PreferencePanes\.register/);
    assert.match(source, /defaultXUL: true/);
    assert.match(source, /preferences\.xhtml/);
    assert.match(source, /preferences\.css/);
    assert.match(source, /attachInitializationPreferences/);
    assert.match(source, /openPreferencesPane/);
  });

  it("keeps the settings controller on the addon API boundary", () => {
    const source = readFileSync(
      resolve(projectRoot, "src/modules/preferences.ts"),
      "utf8",
    );
    assert.match(source, /api\.getInitializationProgress/);
    assert.match(source, /api\s*\.\s*startInitialization/);
    assert.match(source, /api\.cancelInitialization/);
    assert.match(source, /setInterval/);
    assert.match(source, /clearInterval/);
    assert.match(source, /unload/);
  });

  it("opens the settings pane instead of the old wizard", () => {
    const source = readFileSync(
      resolve(projectRoot, "src/modules/menu.ts"),
      "utf8",
    );
    assert.match(source, /openPreferencesPane/);
    assert.doesNotMatch(source, /openInitializationWizard/);
  });

  it("does not auto-open a startup initialization dialog", () => {
    const source = readFileSync(resolve(projectRoot, "src/hooks.ts"), "utf8");
    assert.match(source, /registerPreferencesPane/);
    assert.doesNotMatch(source, /maybeOpenInitializationWizard/);
  });

  it("passes the running plugin API into the preference pane controller", () => {
    const source = readFileSync(resolve(projectRoot, "src/hooks.ts"), "utf8");
    assert.match(
      source,
      /attachInitializationPreferences\(prefWindow, root, addon\.api\)/,
    );
  });

  it("exposes the initialization API from the addon instance", () => {
    const source = readFileSync(resolve(projectRoot, "src/addon.ts"), "utf8");
    assert.match(source, /getInitializationState/);
    assert.match(source, /getInitializationProgress/);
    assert.match(source, /isInitializationRunning/);
    assert.match(source, /startInitialization/);
    assert.match(source, /cancelInitialization/);
    assert.match(source, /openPreferences/);
    assert.match(source, /getSelectedInitializationItemCount/);
  });

  it("resolves the API from the Zotero addon instance when the pane sandbox has no addon global", () => {
    const api = { getInitializationProgress() { return undefined; } };
    const scope = {
      Zotero: { CCFForZotero: { api } },
    };
    assert.equal(resolveInitializationPreferencesAPI(scope), api);
  });

  it("labels and normalizes the selected-items scope using the live selection count", () => {
    assert.equal(getInitializationScopeLabel(3), "主窗口当前选中的文献（3）");
    assert.equal(getInitializationScopeLabel(0), "主窗口当前选中的文献（0）");
    assert.equal(normalizeInitializationScope("selected-items", 3), "selected-items");
    assert.equal(normalizeInitializationScope("selected-items", 0), "current-collection");
  });

  it("keeps a stable id for the selected-items option", () => {
    const markup = readFileSync(
      resolve(projectRoot, "addon/content/preferences.xhtml"),
      "utf8",
    );
    assert.match(markup, /id="ccf-init-selected-items-option"/);
  });
});
