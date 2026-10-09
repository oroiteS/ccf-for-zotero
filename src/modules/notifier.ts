/**
 * Zotero item 通知接线。
 *
 * zotero-plugin-scaffold 生成的 bootstrap 只转发 onStartup /
 * onMainWindowLoad / onMainWindowUnload / onShutdown，并不会把
 * hooks.onNotify 注册到 Zotero.Notifier。因此 Connector 保存、同步、
 * 其它插件写入条目时产生的 add/modify 通知插件根本收不到，新条目
 * 的 CCF/CAS 缓存永远无人补算，列上一直显示 Unknown，直到重启后
 * 被启动预热偶然修复。
 *
 * 这里在插件运行时自行注册 Notifier 观察者，不依赖 scaffold 版本；
 * 若未来 bootstrap 开始转发通知，onNotify 幂等（队列按 id 去重并
 * 防抖合并），双重触发也无害。
 */

import { config } from "../../package.json";

export type ItemNotifyHandler = (
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) => void | Promise<void>;

let observerID: number | string | undefined;
let handler: ItemNotifyHandler | undefined;

export function isItemNotifierRegistered(): boolean {
  return observerID !== undefined;
}

export function registerItemNotifier(nextHandler: ItemNotifyHandler): boolean {
  // 已注册时只更新回调，避免多窗口/重复 startup 造成重复观察者。
  if (observerID !== undefined) {
    handler = nextHandler;
    return true;
  }

  const notifier = (Zotero as any)?.Notifier;
  if (typeof notifier?.registerObserver !== "function") {
    ztoolkit.log("Zotero.Notifier.registerObserver is unavailable");
    return false;
  }

  handler = nextHandler;
  const observer = {
    notify: (
      event: string,
      type: string,
      ids: Array<string | number>,
      extraData: { [key: string]: any },
    ) => handler?.(event, type, ids, extraData),
  };

  try {
    observerID = notifier.registerObserver(observer, ["item"], config.addonRef);
    return observerID !== undefined;
  } catch (error) {
    observerID = undefined;
    handler = undefined;
    ztoolkit.log("Could not register Zotero item notifier", error);
    return false;
  }
}

export function unregisterItemNotifier(): void {
  const id = observerID;
  observerID = undefined;
  handler = undefined;
  if (id === undefined) return;

  const notifier = (Zotero as any)?.Notifier;
  try {
    if (typeof notifier?.unregisterObserver === "function") {
      notifier.unregisterObserver(id);
    }
  } catch (error) {
    ztoolkit.log("Could not unregister Zotero item notifier", error);
  }
}
