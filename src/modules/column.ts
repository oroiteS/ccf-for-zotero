import { config } from "../../package.json";
import { formatNonCcfVenueText } from "./nonCcfAliases";
import { getColumnDisplayState } from "./rankService";
import { ItemRankState } from "./types";

const dataKey = "ccfForZoteroRank";
const sortDataSeparator = "\u001e";
const cellTitleSeparator = "\u001f";

const rankSortOrder: Record<string, string> = {
  A: "010",
  B: "020",
  C: "030",
  T1: "110",
  T2: "120",
  T3: "130",
};

function packColumnData(
  sortKey: string,
  display: string,
  title = display,
): string {
  const cellData =
    title === display ? display : `${display}${cellTitleSeparator}${title}`;
  return `${sortKey}${sortDataSeparator}${cellData}`;
}

export function unpackColumnData(data: string): {
  sortKey: string;
  display: string;
  title: string;
} {
  const [sortKey, cellData = ""] = data.includes(sortDataSeparator)
    ? data.split(sortDataSeparator)
    : ["900", data];
  const [display, title] = cellData.split(cellTitleSeparator);
  return {
    sortKey,
    display: display || "",
    title: title || display || "",
  };
}

function formatTimestamp(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getCatalogLabel(state: ItemRankState): string | undefined {
  if (state.status !== "matched") return undefined;
  return state.rank?.startsWith("T") ? "2025 高质量期刊" : "2026 国际目录";
}

function getSortKey(state: ItemRankState, display: string): string {
  if (state.status === "ignored") return "990";
  if (state.status === "matched" && state.rank) {
    return `${rankSortOrder[state.rank] || "190"}|${state.abbr || display}`;
  }
  if (state.status === "none") return `700|${display}`;
  if (state.status === "preprint") return `800|${display}`;
  return `900|${display}`;
}

function buildTooltip(state: ItemRankState, display: string): string {
  if (!display) return "";
  const lines = [display];
  const catalog = getCatalogLabel(state);
  if (state.category || catalog) {
    lines.push([state.category, catalog].filter(Boolean).join(" · "));
  }
  const source = state.matchedField
    ? `${state.matchedField}${state.matchMethod ? ` · ${state.matchMethod}` : ""}`
    : state.matchMethod;
  if (source) lines.push(`来源：${source}`);
  const updatedAt = formatTimestamp(state.updatedAt);
  if (updatedAt) lines.push(`更新：${updatedAt}`);
  return lines.slice(0, 4).join("\n");
}

export interface FormatColumnOptions {
  /** 条目 Date 字段年份，仅作兜底；venue 标注年份（state.matchYear）优先。 */
  year?: string | number;
}

/**
 * 读取条目 Date 字段中的 4 位年份（会议论文即 proceedings 年份，通常等于
 * 录取年份）。只读单个字段，属于列渲染热路径可接受的开销；不写入缓存，
 * 因此修改日期后无需重建匹配缓存即可直接反映到列上。
 */
export function getItemPublicationYear(item: Zotero.Item): string | undefined {
  let raw = "";
  try {
    raw = String(item?.getField?.("date") ?? "").trim();
    if (!raw) return undefined;
    const parsed = (Zotero as any)?.Date?.strToDate?.(raw);
    const parsedYear = String(parsed?.year ?? "").trim();
    if (/^\d{4}$/.test(parsedYear)) return parsedYear;
  } catch (error) {
    // Zotero 全局不可用（单元测试）或字段读取失败时走正则兜底。
  }
  const match = raw.match(/\d{4}/);
  return match ? match[0] : undefined;
}

function normalizeYear(value?: string | number): string | undefined {
  const text = String(value ?? "").trim();
  return /^\d{4}$/.test(text) ? text : undefined;
}

function appendYearSuffix(text: string, year?: string): string {
  if (!year || !text) return text;
  // venueText 本身已含同年份（如 "AAAI 2026"）时避免重复追加。
  if (new RegExp(`(^|\\s)${year}$`).test(text)) return text;
  return `${text} ${year}`;
}

export function formatColumnDataForState(
  state: ItemRankState,
  options: FormatColumnOptions = {},
): string {
  // 年份依据优先级：venue 标注年份（extra/proceedings 自带，语义可靠）
  // 优先于条目 Date 字段（会议条目的 Date 可能是提交日/剪藏日，语义不可靠）。
  // preprint 条目的 Date 是提交日，与录取届次必然无关，直接不参与兜底——
  // 此时唯一可信来源是手动标注（如 "CCF Venue: AAAI 2027"），没有就不显示。
  const dateYear = normalizeYear(options.year);
  const year =
    normalizeYear(state.matchYear) ||
    (state.preprintSignal ? undefined : dateYear);
  let display = "";
  let title = "";

  if (state.status === "ignored") {
    return packColumnData(getSortKey(state, display), display, title);
  }
  if (state.status === "preprint") {
    display = "Preprint | arXiv";
  } else if (state.status === "unknown") {
    display = "Unknown";
  } else if (state.status === "none") {
    const originalVenue = state.venueText || "Venue";
    const displayVenue = formatNonCcfVenueText(originalVenue);
    display = `CCF None | ${displayVenue}`;
    title = buildTooltip(
      state,
      appendYearSuffix(`CCF None | ${originalVenue}`, year),
    );
  } else if (state.rank) {
    // 目录中不少期刊（如 Neural Networks、Neural Computation）没有官方简称，
    // abbr 为空不代表识别失败；依次回退全称/来源文本，避免把已命中的条目
    // 误显示为 Unknown（识别诊断与列渲染必须保持一致）。
    const venueName = state.abbr || state.fullName || state.venueText || "";
    display = venueName ? `CCF ${state.rank} | ${venueName}` : `CCF ${state.rank}`;
  } else {
    display = "Unknown";
  }

  // 排序键继续使用不带年份的 display，保证追加年份不改变既有排序行为；
  // 徽章展示文本追加年份（如 "CCF A | AAAI 2026"）。
  const displayWithYear = appendYearSuffix(display, year);
  if (!title) title = buildTooltip(state, displayWithYear);
  return packColumnData(getSortKey(state, display), displayWithYear, title);
}

function getBadgeColors(text: string) {
  if (text.startsWith("CCF A |")) {
    return { background: "#dff3e8", color: "#146c43", border: "#b7dfc8" };
  }
  if (text.startsWith("CCF B |")) {
    return { background: "#e8eefc", color: "#2f56a6", border: "#c8d5f6" };
  }
  if (text.startsWith("CCF C |")) {
    return { background: "#fff2cc", color: "#8a5a00", border: "#ead083" };
  }
  if (text.startsWith("CCF T1 |")) {
    return { background: "#dcfce7", color: "#166534", border: "#bbf7d0" };
  }
  if (text.startsWith("CCF T2 |")) {
    return { background: "#e0f2fe", color: "#075985", border: "#bae6fd" };
  }
  if (text.startsWith("CCF T3 |")) {
    return { background: "#fef3c7", color: "#92400e", border: "#fde68a" };
  }
  if (text.startsWith("Preprint |")) {
    return { background: "#edf0f4", color: "#52616b", border: "#d4dae2" };
  }
  if (text.startsWith("CCF None |")) {
    return { background: "#f1e5f6", color: "#7a2c8f", border: "#e0c8e8" };
  }
  return { background: "#f4e8e8", color: "#9b2c2c", border: "#e8c9c9" };
}

export async function registerCCFColumn() {
  await Zotero.ItemTreeManager.registerColumns({
    pluginID: config.addonID,
    dataKey,
    label: "CCF",
    width: "160",
    zoteroPersist: ["width", "hidden", "sortDirection"],
    dataProvider: (item: Zotero.Item) => {
      if (!item || item.isAttachment() || item.isNote()) return "";
      try {
        return formatColumnDataForState(getColumnDisplayState(item), {
          year: getItemPublicationYear(item),
        });
      } catch (error) {
        ztoolkit.log("CCF column dataProvider failed", error);
        return formatColumnDataForState({
          itemKey: `${item.libraryID}:${item.id}`,
          status: "unknown",
          source: "auto",
          confidence: 0,
          updatedAt: new Date().toISOString(),
        });
      }
    },
    renderCell: (
      index: number,
      data: string,
      column: any,
      isFirstColumn: boolean,
      doc: Document,
    ) => {
      const cellData = unpackColumnData(data);
      const cell = doc.createElement("span");
      cell.className = `cell ${column.className}`;
      cell.title = cellData.title || "";
      cell.style.overflow = "hidden";
      cell.style.textOverflow = "ellipsis";
      cell.style.whiteSpace = "nowrap";
      cell.style.minWidth = "0";

      if (!cellData.display) return cell;

      const colors = getBadgeColors(cellData.display);
      const badge = doc.createElement("span");
      badge.textContent = cellData.display;
      badge.style.display = "inline-block";
      badge.style.maxWidth = "100%";
      badge.style.minWidth = "0";
      badge.style.boxSizing = "border-box";
      badge.style.padding = "2px 8px";
      badge.style.border = `1px solid ${colors.border}`;
      badge.style.borderRadius = "6px";
      badge.style.backgroundColor = colors.background;
      badge.style.color = colors.color;
      badge.style.fontWeight = "650";
      badge.style.lineHeight = "1.3";
      badge.style.whiteSpace = "nowrap";
      badge.style.overflow = "hidden";
      badge.style.textOverflow = "ellipsis";
      badge.style.verticalAlign = "middle";
      cell.appendChild(badge);
      return cell;
    },
  });
}


