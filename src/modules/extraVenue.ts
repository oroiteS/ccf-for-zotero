import { CCFVenue } from "./types";

/**
 * 手动设置的持久化辅助：把右键"搜索会议/期刊并设置"选择的 venue
 * 以 "CCF Venue: <简称>" 行写入条目 Extra，使结果成为条目元数据的一部分。
 *
 * 这样即使插件私有缓存丢失（插件卸载重装、清空缓存、换机器），
 * 识别器也会从 Extra 重新命中相同结果；诊断的实时计算同样能看到该线索。
 *
 * 写入是幂等的：重复设置只会更新同一行，不会无限追加。
 */

const VENUE_EXTRA_LINE_PATTERN = /^\s*ccf\s+venue\s*[:=]/i;

export function formatVenueExtraValue(venue: CCFVenue): string {
  return (venue.abbr || "").trim() || venue.fullName.trim();
}

export function upsertVenueLineInExtra(extra: string, value: string): string {
  const newLine = `CCF Venue: ${value}`;
  const lines = (extra || "").split(/\r?\n/);
  let replaced = false;
  const mapped = lines.map((line) => {
    if (VENUE_EXTRA_LINE_PATTERN.test(line)) {
      replaced = true;
      return newLine;
    }
    return line;
  });
  if (replaced) return mapped.join("\n");
  while (mapped.length > 0 && mapped[mapped.length - 1].trim() === "") {
    mapped.pop();
  }
  mapped.push(newLine);
  return mapped.join("\n");
}

export function stripVenueLinesFromExtra(extra: string): string {
  return (extra || "")
    .split(/\r?\n/)
    .filter((line) => !VENUE_EXTRA_LINE_PATTERN.test(line))
    .join("\n");
}

function getItemExtra(item: Zotero.Item): string {
  try {
    const value = item.getField("extra");
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** 把 venue 写入条目 Extra；内容无变化时不保存。返回是否发生了写入。 */
export async function writeVenueToExtra(
  item: Zotero.Item,
  venue: CCFVenue,
): Promise<boolean> {
  const current = getItemExtra(item);
  const next = upsertVenueLineInExtra(current, formatVenueExtraValue(venue));
  if (next === current) return false;
  item.setField("extra", next);
  await item.saveTx();
  return true;
}

/** 清除条目 Extra 中的 CCF Venue 行；返回是否发生了写入。 */
export async function removeVenueFromExtra(item: Zotero.Item): Promise<boolean> {
  const current = getItemExtra(item);
  const next = stripVenueLinesFromExtra(current);
  if (next === current) return false;
  item.setField("extra", next);
  await item.saveTx();
  return true;
}
