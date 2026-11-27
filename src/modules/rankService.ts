import { getCatalogVersion, getMatcherVersion, matchCandidates } from "./matcher";
import { getItemInputFingerprint, resolveItemMatch } from "./venueResolver";
import {
  getItemInvalidationEpoch,
  getItemKey,
  getStoredState,
  saveMatchResult,
  saveMatchResults,
  SaveMatchResultEntry,
} from "./storage";
import { ITEM_STATE_VERSION, ItemRankState, MatchResult } from "./types";

/**
 * 条目状态结构的 schema 版本（常量定义在 types.ts，storage 落盘共用）。
 * 显示逻辑新增字段（如 matchYear、preprintSignal）时递增；旧版本缓存
 * 会被 warmup / 失效重算自动迁移，避免升级插件后列表一直读旧缓存
 * （如 date 兜底年份）而诊断却是新结果。
 */
export { ITEM_STATE_VERSION };

export interface GetDisplayStateOptions {
  computeIfMissing?: boolean;
  validateInputFingerprint?: boolean;
  allowStaleCatalogVersion?: boolean;
}

export interface RefreshItemsRankOptions {
  onProgress?: (
    done: number,
    total: number,
    item: Zotero.Item,
    result: MatchResult,
  ) => void | Promise<void>;
  shouldCancel?: () => boolean;
  saveBatchSize?: number;
}

export interface RefreshItemsRankResult {
  entries: Array<{ item: Zotero.Item; result: MatchResult }>;
  processed: number;
  total: number;
  cancelled: boolean;
}

export interface FilterItemsByDisplayStatusOptions {
  onProgress?: (
    done: number,
    total: number,
    item: Zotero.Item,
    state: ItemRankState,
  ) => void | Promise<void>;
  shouldCancel?: () => boolean;
}

export interface FilterItemsByDisplayStatusResult {
  items: Zotero.Item[];
  processed: number;
  total: number;
  cancelled: boolean;
}

export function resolveItemRank(item: Zotero.Item): MatchResult {
  return resolveItemMatch(item);
}

export function getDisplayState(
  item: Zotero.Item,
  options: GetDisplayStateOptions = {},
): ItemRankState {
  const stored = getStoredState(item, {
    validateInputFingerprint: options.validateInputFingerprint,
    allowStaleCatalogVersion: options.allowStaleCatalogVersion,
  });
  if (stored) {
    return stored;
  }

  if (options.computeIfMissing === false) {
    return toItemRankState(item, {
      status: "unknown",
      source: "auto",
      confidence: 0,
      matchMethod: "无有效缓存；未在列排序路径即时计算",
    });
  }

  const result = resolveItemRank(item);
  return toItemRankState(item, result);
}

/**
 * The Zotero custom-column hot path must never run the matcher or read every
 * venue field. Background refreshes populate this cache separately.
 */
export function getColumnDisplayState(item: Zotero.Item): ItemRankState {
  return getDisplayState(item, {
    computeIfMissing: false,
    validateInputFingerprint: false,
    allowStaleCatalogVersion: true,
  });
}

export function hasCachedRankState(item: Zotero.Item): boolean {
  return Boolean(
    getStoredState(item, { validateInputFingerprint: false }),
  );
}

/**
 * 该条目是否需要（重新）计算匹配缓存：完全无缓存，或缓存的目录/匹配器/结构版本
 * 低于当前实现。warmup、列按需迁移与失效重算应统一使用本函数，保证升级后旧缓存
 * 平滑迁移而不覆盖手动指定/忽略状态。
 */
export function needsRankRecompute(item: Zotero.Item): boolean {
  const stored = getStoredState(item, { validateInputFingerprint: false });
  if (!stored) return true;
  // 手动指定/忽略状态是用户意志，永不被自动重算覆盖。
  if (stored.source === "manual") return false;
  return (
    (stored.stateVersion ?? 1) < ITEM_STATE_VERSION ||
    stored.catalogVersion !== getCatalogVersion() ||
    stored.matcherVersion !== getMatcherVersion()
  );
}

function toItemRankState(item: Zotero.Item, result: MatchResult): ItemRankState {
  return {
    itemKey: getItemKey(item),
    status: result.status,
    source: result.source,
    rank: result.rank,
    abbr: result.abbr,
    fullName: result.fullName,
    category: result.category,
    venueText: result.venueText,
    confidence: result.confidence,
    matchedField: result.matchedField,
    matchedValue: result.matchedValue,
    matchMethod: result.matchMethod,
    matchYear: result.year,
    preprintSignal: result.preprintSignal,
    stateVersion: ITEM_STATE_VERSION,
    catalogVersion: getCatalogVersion(),
    matcherVersion: getMatcherVersion(),
    updatedAt: new Date().toISOString(),
  };
}

export function refreshItemRank(item: Zotero.Item) {
  const expectedInputFingerprint = getItemInputFingerprint(item);
  const expectedInvalidationEpoch = getItemInvalidationEpoch(item.id);
  const result = resolveItemRank(item);
  saveMatchResult(item, result, {
    expectedInputFingerprint,
    expectedInvalidationEpoch,
  });
  return result;
}

export async function filterItemsByDisplayStatus(
  items: Zotero.Item[],
  statuses: Array<ItemRankState["status"]>,
  options: FilterItemsByDisplayStatusOptions = {},
): Promise<FilterItemsByDisplayStatusResult> {
  const statusSet = new Set(statuses);
  const matchedItems: Zotero.Item[] = [];
  const total = items.length;
  let processed = 0;

  for (let index = 0; index < items.length; index++) {
    if (options.shouldCancel?.()) break;

    const item = items[index];
    const state = getDisplayState(item, {
      computeIfMissing: false,
      validateInputFingerprint: true,
      allowStaleCatalogVersion: true,
    });
    processed = index + 1;
    if (statusSet.has(state.status)) {
      matchedItems.push(item);
    }

    await options.onProgress?.(processed, total, item, state);
  }

  return {
    items: matchedItems,
    processed,
    total,
    cancelled: processed < total || Boolean(options.shouldCancel?.()),
  };
}

export async function refreshItemsRank(
  items: Zotero.Item[],
  options: RefreshItemsRankOptions = {},
): Promise<RefreshItemsRankResult> {
  const entries: Array<{ item: Zotero.Item; result: MatchResult }> = [];
  let pendingSave: SaveMatchResultEntry[] = [];
  const total = items.length;
  const saveBatchSize = Math.max(options.saveBatchSize || total || 1, 1);

  for (let index = 0; index < items.length; index++) {
    if (options.shouldCancel?.()) break;

    const item = items[index];
    const expectedInputFingerprint = getItemInputFingerprint(item);
    const expectedInvalidationEpoch = getItemInvalidationEpoch(item.id);
    const result = resolveItemRank(item);
    entries.push({ item, result });
    pendingSave.push({
      item,
      result,
      expectedInputFingerprint,
      expectedInvalidationEpoch,
    });

    if (pendingSave.length >= saveBatchSize) {
      saveMatchResults(pendingSave);
      pendingSave = [];
    }

    await options.onProgress?.(entries.length, total, item, result);
  }

  saveMatchResults(pendingSave);

  return {
    entries,
    processed: entries.length,
    total,
    cancelled: entries.length < total || Boolean(options.shouldCancel?.()),
  };
}
