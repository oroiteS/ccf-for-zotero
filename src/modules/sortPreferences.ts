import { config } from "../../package.json";
import { refreshAllItemTrees } from "./viewRefresh";

export type CCFSortMode = "rank" | "year";
export const CCF_SORT_MODE_KEY = `${config.prefsPrefix}.ccfSortMode`;

/** 保留旧版等级优先的默认行为。 */
export function getCCFSortMode(): CCFSortMode {
  try {
    return Zotero.Prefs.get(CCF_SORT_MODE_KEY, true) === "year" ? "year" : "rank";
  } catch {
    return "rank";
  }
}

export function setCCFSortMode(mode: CCFSortMode): void {
  if (mode !== "rank" && mode !== "year") {
    throw new Error("Invalid CCF sort mode");
  }
  Zotero.Prefs.set(CCF_SORT_MODE_KEY, mode, true);
  refreshAllItemTrees({ resort: true });
}
