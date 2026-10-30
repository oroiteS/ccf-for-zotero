import { matchCandidates } from "./matcher";
import { formatNonCcfVenueText } from "./nonCcfAliases";
import { getItemPublicationYear } from "./column";
import { MatchResult, VenueCandidate } from "./types";
import { resolveItemMatch, resolveVenueCandidates } from "./venueResolver";

const inspectedFields = [
  "title",
  "publicationTitle",
  "proceedingsTitle",
  "conferenceName",
  "journalAbbreviation",
  "seriesTitle",
  "date",
  "DOI",
  "url",
  "extra",
];

export interface ItemDiagnostics {
  itemType: string;
  fields: Array<{ field: string; value: string }>;
  candidates: VenueCandidate[];
  isPreprint: boolean;
  result: MatchResult;
  year?: string;
  /** 年份依据来源：venue 标注（可靠）或条目 Date 字段（兜底）。 */
  yearSource?: "venue" | "date";
}

function getField(item: Zotero.Item, field: string): string {
  try {
    const value = item.getField(field);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function formatConfidence(result: MatchResult): string {
  if (typeof result.confidence !== "number") return "n/a";
  return `${Math.round(result.confidence * 100)}%`;
}

function formatEvidence(result: MatchResult): string[] {
  const lines: string[] = [];
  if (result.matchedField) lines.push(`命中字段：${result.matchedField}`);
  if (result.matchedValue) lines.push(`命中线索：${result.matchedValue}`);
  if (result.matchMethod) lines.push(`匹配规则：${result.matchMethod}`);
  return lines;
}

function appendYearSuffix(text: string, year?: string): string {
  if (!year || !text) return text;
  // venue 文本本身已含同年份（如 "AAAI 2026"）时避免重复追加。
  if (new RegExp(`(^|\\s)${year}$`).test(text)) return text;
  return `${text} ${year}`;
}

function formatResult(result: MatchResult, year?: string): string {
  if (result.status === "matched") {
    return [
      `结果：${appendYearSuffix(
        `CCF ${result.rank} | ${result.abbr || result.fullName || result.venueText || "n/a"}`,
        year,
      )}`,
      `全称：${result.fullName || "n/a"}`,
      `分类：${result.category || "n/a"}`,
      `来源文本：${result.venueText || "n/a"}`,
      ...formatEvidence(result),
      `置信度：${formatConfidence(result)}`,
    ].join("\n");
  }

  if (result.status === "none") {
    const venueText = result.venueText || "n/a";
    return [
      `结果：${appendYearSuffix(
        `CCF None | ${formatNonCcfVenueText(venueText)}`,
        year,
      )}`,
      `来源文本：${venueText}`,
      ...formatEvidence(result),
      `置信度：${formatConfidence(result)}`,
    ].join("\n");
  }

  if (result.status === "preprint") {
    return [
      "结果：Preprint | arXiv",
      `来源文本：${result.venueText || "arXiv"}`,
      ...formatEvidence(result),
      `置信度：${formatConfidence(result)}`,
    ].join("\n");
  }

  return [
    "结果：Unknown",
    ...formatEvidence(result),
    `置信度：${formatConfidence(result)}`,
  ].join("\n");
}

function explainResult(diagnostics: ItemDiagnostics): string {
  if (diagnostics.result.status === "unknown") {
    if (diagnostics.candidates.length === 0) {
      return "原因：没有读取到可用的 publication/proceedings/conference/journal venue 字段；如果只有 DOI/URL，当前离线规则也无法推出 venue。";
    }
    return "原因：读取到了候选 venue，但没有足够证据匹配到 CCF 目录。";
  }

  if (diagnostics.result.status === "none") {
    return "原因：候选 venue 未命中当前本地 CCF 目录（2026 国际 A/B/C + 2025 高质量期刊 T1/T2/T3），或被 Findings/Companion/Extended Abstracts/Workshop 等严格规则保留为 CCF None。";
  }

  if (diagnostics.result.status === "preprint") {
    return "原因：检测到 arXiv/preprint 信号，且没有更强的正式 venue 候选。";
  }

  if (diagnostics.result.rank?.startsWith("T")) {
    return "原因：候选 venue 命中本地 CCF 2025 计算领域高质量科技期刊目录。";
  }

  return "原因：候选 venue 命中本地 CCF 2026 推荐国际学术会议和期刊目录。";
}

export function getItemDiagnostics(item: Zotero.Item): ItemDiagnostics {
  // 与列缓存重算走同一入口（resolveItemMatch），保证诊断与列表显示一致。
  const result = resolveItemMatch(item);
  const resolution = resolveVenueCandidates(item);
  // 与列显示保持同一优先级：venue 标注年份优先；preprint 条目的 Date 是
  // 提交日，与录取届次无关，不参与兜底。
  const dateYear = getItemPublicationYear(item);
  const dateUsable = !result.preprintSignal;
  const year = result.year || (dateUsable ? dateYear : undefined);
  return {
    itemType: item.itemType,
    fields: inspectedFields
      .map((field) => ({ field, value: getField(item, field) }))
      .filter((entry) => entry.value),
    candidates: resolution.candidates,
    isPreprint: resolution.isPreprint,
    result,
    year,
    yearSource: result.year
      ? "venue"
      : dateUsable && dateYear
        ? "date"
        : undefined,
  };
}

export function formatItemDiagnostics(item: Zotero.Item): string {
  const diagnostics = getItemDiagnostics(item);
  const lines = [
    "CCF 识别诊断",
    "",
    `Item type：${diagnostics.itemType || "n/a"}`,
    "",
    "读取字段：",
  ];

  if (diagnostics.fields.length) {
    for (const entry of diagnostics.fields) {
      lines.push(`- ${entry.field}: ${entry.value}`);
    }
  } else {
    lines.push("- 未读取到关键字段");
  }

  lines.push("", "候选 venue：");
  if (diagnostics.candidates.length) {
    diagnostics.candidates.forEach((candidate, index) => {
      const kind = candidate.kindHint ? `, ${candidate.kindHint}` : "";
      const context = candidate.context ? `, context=${candidate.context}` : "";
      lines.push(
        `${index + 1}. [${candidate.field}${kind}${context}] ${candidate.value}`,
      );
    });
  } else {
    lines.push("- 无候选 venue");
  }

  lines.push("", "最终判定：", formatResult(diagnostics.result, diagnostics.year));
  if (diagnostics.year) {
    const source =
      diagnostics.yearSource === "venue"
        ? "venue 标注年份"
        : "条目 Date 字段";
    lines.push(`显示年份：${diagnostics.year}（来源：${source}）`);
  } else if (diagnostics.result.preprintSignal) {
    lines.push(
      "显示年份：无（preprint 条目的 Date 是提交日期，不代表录取届次；请在 Extra 的 venue 标注中补年份，如 CCF Venue: AAAI 2027）",
    );
  }
  lines.push("", explainResult(diagnostics));

  return lines.join("\n");
}
