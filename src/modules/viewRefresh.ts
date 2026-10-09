type RefreshTarget = Zotero.Item | string | number | undefined | null;

const MAX_DIRECT_ROW_LOOKUPS = 250;

function callViewMethod(target: any, method: string): boolean {
  if (typeof target?.[method] !== "function") return false;
  try {
    target[method]();
    return true;
  } catch (error) {
    ztoolkit.log(`Could not refresh Zotero item view via ${method}`, error);
    return false;
  }
}

function getTargetItemID(target: RefreshTarget): string | undefined {
  if (target === undefined || target === null) return undefined;
  if (typeof target === "string" || typeof target === "number") {
    return String(target);
  }
  if (typeof (target as Zotero.Item).id === "number") {
    return String((target as Zotero.Item).id);
  }
  return undefined;
}

function getRowIndexByItemID(itemsView: any, itemID: string): number | undefined {
  if (typeof itemsView?.getRowIndexByID !== "function") return undefined;
  for (const value of [itemID, Number(itemID)]) {
    if (value === "" || (typeof value === "number" && !Number.isFinite(value))) {
      continue;
    }
    try {
      const rowIndex = itemsView.getRowIndexByID(value);
      if (
        rowIndex !== false &&
        rowIndex !== undefined &&
        rowIndex !== null &&
        Number(rowIndex) >= 0
      ) {
        return Number(rowIndex);
      }
    } catch {
      // Zotero builds differ on whether item IDs are strings or numbers.
    }
  }
  return undefined;
}

function getRowItemID(row: any): string | undefined {
  const candidates = [
    row?.ref?.id,
    row?.item?.id,
    row?.data?.item?.id,
    row?.id,
    row?.itemID,
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) {
      return String(candidate);
    }
  }
  return undefined;
}

function invalidateVisibleRowsByID(
  itemsView: any,
  tree: any,
  itemIDs: Set<string>,
): boolean {
  if (
    typeof tree?.getFirstVisibleRow !== "function" ||
    typeof tree?.getLastVisibleRow !== "function" ||
    typeof itemsView?.getRow !== "function"
  ) {
    return false;
  }

  try {
    const first = Math.max(0, Number(tree.getFirstVisibleRow()));
    const last = Math.max(first, Number(tree.getLastVisibleRow()));
    let refreshed = false;
    for (let rowIndex = first; rowIndex <= last; rowIndex++) {
      const rowItemID = getRowItemID(itemsView.getRow(rowIndex));
      if (!rowItemID || !itemIDs.has(rowItemID)) continue;
      if (typeof tree.invalidateRow === "function") {
        tree.invalidateRow(rowIndex);
      } else if (typeof itemsView.invalidateRow === "function") {
        itemsView.invalidateRow(rowIndex);
      } else {
        return false;
      }
      refreshed = true;
    }
    return refreshed;
  } catch (error) {
    ztoolkit.log("Could not invalidate visible Zotero item rows", error);
    return false;
  }
}

function collectTargetItemIDs(targets: RefreshTarget[]): Set<string> {
  const itemIDs = new Set<string>();
  for (const target of targets) {
    const itemID = getTargetItemID(target);
    if (itemID) itemIDs.add(itemID);
  }
  return itemIDs;
}

function toNumericItemIDs(itemIDs: Set<string>): number[] {
  const numericIDs: number[] = [];
  for (const id of itemIDs) {
    const numeric = Number(id);
    if (Number.isFinite(numeric) && numeric > 0) numericIDs.push(numeric);
  }
  return numericIDs;
}

/**
 * 清除 ItemTree 的行显示数据缓存。
 *
 * 行数据（包括自定义列 dataProvider 的返回值）被缓存在 itemsView._rowCache，
 * Zotero 只在收到 item modify/refresh 通知时才清除它。插件更新自己的私有
 * 缓存不会触发这些通知，因此必须主动清除；否则随后的 invalidateRow/
 * invalidate 只会用 _rowCache 里的旧数据重绘，CCF/CAS 列停留在 Unknown。
 *
 * Zotero 10 提供公开的 invalidateRowCache(ids|true)；Zotero 7 没有该方法，
 * 退化为手动清理 _rowCache（这正是 Zotero 7 内部通知处理的做法）。
 */
function clearItemTreeRowCache(itemsView: any, ids: number[] | true): void {
  if (!itemsView) return;
  try {
    if (typeof itemsView.invalidateRowCache === "function") {
      itemsView.invalidateRowCache(ids);
      return;
    }
    if (!itemsView._rowCache) return;
    if (ids === true) {
      itemsView._rowCache = {};
    } else {
      for (const id of ids) {
        delete itemsView._rowCache[id];
      }
    }
  } catch (error) {
    ztoolkit.log("Could not clear Zotero item tree row cache", error);
  }
}

export function invalidateItemRows(targets: RefreshTarget[]): boolean {
  if (!targets.length) return false;
  try {
    const itemsView = Zotero.getActiveZoteroPane?.()?.itemsView as any;
    const tree = itemsView?.tree || itemsView?._tree;
    const itemIDs = collectTargetItemIDs(targets);
    if (itemIDs.size === 0) return false;

    // 重绘前先清行数据缓存，保证 dataProvider 被重新调用并读到新缓存。
    clearItemTreeRowCache(itemsView, toNumericItemIDs(itemIDs));

    if (itemIDs.size > MAX_DIRECT_ROW_LOOKUPS) {
      if (invalidateVisibleRowsByID(itemsView, tree, itemIDs)) return true;
      clearItemTreeRowCache(itemsView, true);
      return [
        callViewMethod(tree, "invalidate"),
        callViewMethod(itemsView, "invalidate"),
      ].some(Boolean);
    }

    let refreshed = false;

    for (const itemID of itemIDs) {
      const rowIndex = getRowIndexByItemID(itemsView, itemID);
      if (rowIndex === undefined) continue;

      if (typeof tree?.invalidateRow === "function") {
        tree.invalidateRow(rowIndex);
        refreshed = true;
      } else if (typeof itemsView?.invalidateRow === "function") {
        itemsView.invalidateRow(rowIndex);
        refreshed = true;
      }
    }

    return refreshed;
  } catch (error) {
    ztoolkit.log("Could not invalidate Zotero item rows", error);
    return false;
  }
}

function invalidateActiveItemTree(): boolean {
  try {
    const itemsView = Zotero.getActiveZoteroPane?.()?.itemsView as any;
    // 整树重绘前同样要先清行数据缓存，否则重绘仍会读取 _rowCache 旧值。
    clearItemTreeRowCache(itemsView, true);
    return [
      callViewMethod(itemsView?.tree, "invalidate"),
      callViewMethod(itemsView?._tree, "invalidate"),
    ].some(Boolean);
  } catch (error) {
    ztoolkit.log("Could not soft-refresh Zotero item view", error);
    return false;
  }
}

export function softRefreshItemsView(targets: RefreshTarget[] = []): boolean {
  if (invalidateItemRows(targets)) return true;

  // 定向行失效失败（目标行不在当前视图、行 API 缺失等）时退化为
  // 整树轻量失效，确保缓存补算后可见行总能重绘，而不是停在 Unknown。
  return invalidateActiveItemTree();
}

export function refreshItemsViewAndMaintainSelection(
  targets: RefreshTarget[] = [],
): boolean {
  if (invalidateItemRows(targets)) return true;

  if (targets.length > 0) {
    return invalidateActiveItemTree();
  }

  try {
    const itemsView = Zotero.getActiveZoteroPane?.()?.itemsView as any;
    if (callViewMethod(itemsView, "refreshAndMaintainSelection")) return true;
    if (callViewMethod(itemsView, "refresh")) return true;
    return softRefreshItemsView();
  } catch (error) {
    ztoolkit.log("Could not refresh Zotero item view", error);
    return false;
  }
}

export function getActiveViewIdentity(): string {
  const pane = Zotero.getActiveZoteroPane?.() as any;
  let libraryID = "";
  let collectionID = "";
  let savedSearchID = "";
  let groupID = "";

  try {
    libraryID = String(pane?.getSelectedLibraryID?.() ?? "");
  } catch {
    // The pane can be between collection-tree transitions.
  }
  try {
    collectionID = String(pane?.getSelectedCollection?.(true) ?? "");
  } catch {
    // Saved searches and group roots may not expose a collection ID.
  }
  try {
    savedSearchID = String(pane?.getSelectedSavedSearch?.(true) ?? "");
  } catch {
    // Optional API on older Zotero builds.
  }
  try {
    groupID = String(pane?.getSelectedGroup?.(true) ?? "");
  } catch {
    // Optional API on older Zotero builds.
  }

  return [libraryID, collectionID, savedSearchID, groupID].join("|");
}
