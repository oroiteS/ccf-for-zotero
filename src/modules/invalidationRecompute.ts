import { hasBundledCASSnapshot } from "./casCatalog";
import { isInitializationRunning } from "./initialization";
import {
  hasCachedCASState,
  refreshCASItems,
} from "./casService";
import {
  hasCachedRankState,
  refreshItemsRank,
} from "./rankService";
import { softRefreshItemsView } from "./viewRefresh";

/**
 * 条目被修改（用户编辑、同步、其它插件）后，storage 层会把缓存标记为失效，
 * 列热路径随即显示 Unknown。过去这需要用户手动刷新才能恢复。
 * 本模块把失效条目放进一个防抖的后台重算队列，自动补齐缓存并刷新对应行。
 *
 * 安全性：重算只运行本地匹配器并写入插件私有偏好，不修改任何 Zotero 条目，
 * 因此不会触发新的 item modify 通知，不存在自触发死循环。
 */

const RECOMPUTE_DEBOUNCE_MS = 2000;
const RECOMPUTE_RETRY_MS = 5000;
const RECOMPUTE_SAVE_BATCH_SIZE = 25;
const RECOMPUTE_VIEW_REFRESH_EVERY = 25;
const RECOMPUTE_PROGRESS_EVERY = 25;
// 低于该数量时静默处理，避免为单条编辑弹出进度窗口。
const RECOMPUTE_PROGRESS_THRESHOLD = 20;

interface RecomputeJob {
  id: number;
  cancelRequested: boolean;
  progressWindow?: any;
}

export interface InvalidationRecomputeResult {
  processed: number;
  ccfItems: number;
  casItems: number;
  skipped: boolean;
}

let nextJobID = 1;
let activeJob: RecomputeJob | undefined;
let generation = 0;
const pendingIDs = new Set<string>();

let timerHandle: unknown;
let clearTimerFn: ((handle: unknown) => void) | undefined;

function isRegularItem(item: any): item is Zotero.Item {
  if (!item) return false;
  try {
    return typeof item.isRegularItem !== "function" || item.isRegularItem();
  } catch {
    return false;
  }
}

function delay(win: Window | undefined, milliseconds = 0): Promise<void> {
  return new Promise((resolve) => {
    const setTimeoutFromWindow = (win as any)?.setTimeout;
    if (setTimeoutFromWindow) {
      setTimeoutFromWindow.call(win, resolve, milliseconds);
    } else {
      setTimeout(resolve, milliseconds);
    }
  });
}

function cancelScheduledRecompute(): void {
  if (timerHandle === undefined) return;
  const handle = timerHandle;
  const clear = clearTimerFn;
  timerHandle = undefined;
  clearTimerFn = undefined;
  try {
    clear?.(handle);
  } catch {
    // The timer window may already be gone during shutdown.
  }
}

function scheduleRecompute(delayMs: number): void {
  cancelScheduledRecompute();
  const win = Zotero?.getMainWindows?.()[0] as any | undefined;
  const fire = () => {
    timerHandle = undefined;
    clearTimerFn = undefined;
    void runInvalidationRecomputeNow();
  };
  if (win && typeof win.setTimeout === "function") {
    clearTimerFn = (handle) => win.clearTimeout(handle);
    timerHandle = win.setTimeout(fire, delayMs);
  } else {
    clearTimerFn = (handle) => clearTimeout(handle as any);
    timerHandle = setTimeout(fire, delayMs);
  }
}

function collectItemsFromIDs(ids: Set<string>): Zotero.Item[] {
  const items: Zotero.Item[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    let candidate: unknown;
    try {
      const numeric = Number(id);
      candidate = Number.isFinite(numeric) && id.trim() !== ""
        ? Zotero.Items.get(numeric)
        : Zotero.Items.get(id as any);
      if (!candidate && id) {
        candidate = Zotero.Items.get(id as any);
      }
    } catch {
      // The item may have been deleted between notify and recompute.
      continue;
    }
    if (!isRegularItem(candidate)) continue;
    const key = `${candidate.libraryID}:${candidate.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(candidate);
  }
  return items;
}

function createProgressWindow(total: number) {
  try {
    return new ztoolkit.ProgressWindow("CCF/CAS 自动更新", {
      closeOnClick: false,
      closeOtherProgressWindows: false,
    })
      .createLine({
        text: "更新 " + String(total) + " 个条目",
        progress: 0,
      })
      .show(-1);
  } catch (error) {
    ztoolkit.log("Could not open CCF/CAS recompute progress window", error);
    return undefined;
  }
}

function updateProgress(job: RecomputeJob, done: number, total: number) {
  if (!job.progressWindow) return;
  try {
    job.progressWindow.changeLine({
      text: job.cancelRequested
        ? "正在取消自动更新..."
        : "更新 " + String(done) + "/" + String(total),
      progress: total ? Math.round((done / total) * 100) : 100,
    });
  } catch (error) {
    ztoolkit.log("Could not update CCF/CAS recompute progress window", error);
  }
}

function closeProgress(job: RecomputeJob, done: number, total: number) {
  if (!job.progressWindow) return;
  try {
    job.progressWindow.changeLine({
      type: job.cancelRequested ? "default" : "success",
      text: job.cancelRequested
        ? "自动更新已取消 " + String(done) + "/" + String(total)
        : "自动更新完成 " + String(done) + "/" + String(total),
      progress: total ? Math.round((done / total) * 100) : 100,
    });
    job.progressWindow.startCloseTimer(job.cancelRequested ? 2500 : 1200);
  } catch (error) {
    ztoolkit.log("Could not close CCF/CAS recompute progress window", error);
  }
  job.progressWindow = undefined;
}

export function hasPendingInvalidationRecompute(): boolean {
  return pendingIDs.size > 0 || timerHandle !== undefined;
}

export function isInvalidationRecomputeRunning(): boolean {
  return Boolean(activeJob);
}

/**
 * 把 modify 通知里的条目 id 加入防抖重算队列。重复调用会合并并顺延定时器。
 */
export function queueInvalidationRecompute(
  ids: Array<string | number>,
): void {
  if (!ids || ids.length === 0) return;
  for (const id of ids) {
    if (id === undefined || id === null) continue;
    pendingIDs.add(String(id));
  }
  if (pendingIDs.size === 0) return;
  scheduleRecompute(RECOMPUTE_DEBOUNCE_MS);
}

/**
 * 立即处理当前排队的失效条目（也由防抖定时器调用）。
 */
export async function runInvalidationRecomputeNow(): Promise<InvalidationRecomputeResult> {
  cancelScheduledRecompute();

  const emptyResult: InvalidationRecomputeResult = {
    processed: 0,
    ccfItems: 0,
    casItems: 0,
    skipped: false,
  };

  if (activeJob) {
    return { ...emptyResult, skipped: true };
  }

  if (isInitializationRunning()) {
    // 初始化会整库重建缓存，避免与它竞争；保留队列稍后重试。
    if (pendingIDs.size > 0) {
      scheduleRecompute(RECOMPUTE_RETRY_MS);
    }
    return { ...emptyResult, skipped: true };
  }

  const ids = [...pendingIDs];
  pendingIDs.clear();
  if (ids.length === 0) return emptyResult;

  const items = collectItemsFromIDs(new Set(ids));
  const ccfItems = items.filter((item) => !hasCachedRankState(item));
  const casItems = hasBundledCASSnapshot()
    ? items.filter((item) => !hasCachedCASState(item))
    : [];
  const total = ccfItems.length + casItems.length;
  if (total === 0) return emptyResult;

  const job: RecomputeJob = { id: nextJobID++, cancelRequested: false };
  activeJob = job;
  const jobGeneration = generation;
  if (total > RECOMPUTE_PROGRESS_THRESHOLD) {
    job.progressWindow = createProgressWindow(total);
  }

  const win = Zotero?.getMainWindows?.()[0] as any | undefined;
  let done = 0;
  let changedItems: Zotero.Item[] = [];
  const flushView = () => {
    if (changedItems.length === 0) return;
    softRefreshItemsView(changedItems);
    changedItems = [];
  };
  const onItemDone = async (item: Zotero.Item) => {
    done += 1;
    changedItems.push(item);
    if (changedItems.length >= RECOMPUTE_VIEW_REFRESH_EVERY) flushView();
    if (
      job.progressWindow &&
      (done === 1 || done === total || done % RECOMPUTE_PROGRESS_EVERY === 0)
    ) {
      updateProgress(job, done, total);
    }
    await delay(win, 0);
  };

  try {
    if (ccfItems.length > 0) {
      await refreshItemsRank(ccfItems, {
        saveBatchSize: RECOMPUTE_SAVE_BATCH_SIZE,
        shouldCancel: () => job.cancelRequested,
        onProgress: async (_done, _total, item) => onItemDone(item),
      });
    }

    if (casItems.length > 0 && !job.cancelRequested) {
      try {
        await refreshCASItems(casItems, {
          saveBatchSize: RECOMPUTE_SAVE_BATCH_SIZE,
          shouldCancel: () => job.cancelRequested,
          onProgress: async (_done, _total, item) => onItemDone(item),
        });
      } catch (error) {
        // CAS 快照加载失败不应影响已完成的 CCF 结果。
        ztoolkit.log("CCF/CAS recompute skipped the CAS pass", error);
      }
    }

    if (jobGeneration === generation && !job.cancelRequested) {
      flushView();
    }
    closeProgress(job, done, total);
    return { processed: done, ccfItems: ccfItems.length, casItems: casItems.length, skipped: false };
  } catch (error) {
    ztoolkit.log("CCF/CAS invalidation recompute failed", error);
    return { processed: done, ccfItems: ccfItems.length, casItems: casItems.length, skipped: true };
  } finally {
    if (activeJob?.id === job.id) activeJob = undefined;
    // 运行期间又有条目被修改时，安排下一轮。
    if (pendingIDs.size > 0) {
      scheduleRecompute(RECOMPUTE_DEBOUNCE_MS);
    }
  }
}

/** 仅用于测试：清空内部状态。 */
export function resetInvalidationRecomputeForTest(): void {
  cancelScheduledRecompute();
  pendingIDs.clear();
  activeJob = undefined;
  generation += 1;
}

export function shutdownInvalidationRecompute(): void {
  generation += 1;
  cancelScheduledRecompute();
  pendingIDs.clear();
  if (activeJob) {
    activeJob.cancelRequested = true;
    activeJob = undefined;
  }
}
