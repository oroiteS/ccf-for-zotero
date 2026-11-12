import { config } from "../../package.json";
import { refreshAllItemTrees } from "./viewRefresh";

export type CCFDisplayStyle = "compact" | "classic";
export const CCF_DISPLAY_STYLE_KEY = `${config.prefsPrefix}.ccfDisplayStyle`;

/** 未设置或设置值无效时保留原版显示，避免升级后意外改变用户界面。 */
export function getCCFDisplayStyle(): CCFDisplayStyle {
  try {
    return Zotero.Prefs.get(CCF_DISPLAY_STYLE_KEY, true) === "compact"
      ? "compact"
      : "classic";
  } catch {
    return "classic";
  }
}

export function setCCFDisplayStyle(style: CCFDisplayStyle): void {
  if (style !== "compact" && style !== "classic") {
    throw new Error("Invalid CCF display style");
  }
  Zotero.Prefs.set(CCF_DISPLAY_STYLE_KEY, style, true);
  refreshAllItemTrees();
}
