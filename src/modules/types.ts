export type CCFKind = "conference" | "journal";
export type CCFRank = "A" | "B" | "C" | "T1" | "T2" | "T3";

/**
 * 条目缓存状态的 schema 版本。显示逻辑新增字段（matchYear、preprintSignal
 * 等）时递增；storage 落盘与重算过滤都依赖它做旧缓存迁移。
 */
export const ITEM_STATE_VERSION = 2;

export interface CCFVenue {
  kind: CCFKind;
  abbr: string;
  fullName: string;
  rank: CCFRank;
  category: string;
  aliases?: string[];
  language?: string;
  cn?: string;
  sponsor?: string;
  sourceIndex?: number;
}

export interface CCFDataFile {
  version: string;
  updateDate: string;
  source: string;
  venues: CCFVenue[];
}

export type RankStatus =
  | "matched"
  | "none"
  | "unknown"
  | "preprint"
  | "ignored";

export interface ItemRankState {
  itemKey: string;
  status: RankStatus;
  source: "auto" | "manual";
  rank?: CCFRank;
  abbr?: string;
  fullName?: string;
  category?: string;
  venueText?: string;
  confidence?: number;
  inputFingerprint?: string;
  matchedField?: string;
  matchedValue?: string;
  matchMethod?: string;
  /** venue 标注年份（extra/proceedings 文本自带），优先于条目 Date 字段。 */
  matchYear?: string;
  /** 条目带 arXiv/preprint 信号；Date 字段为提交日，不用于年份显示兜底。 */
  preprintSignal?: boolean;
  /** 缓存结构的 schema 版本（见 rankService.ITEM_STATE_VERSION）。 */
  stateVersion?: number;
  catalogVersion?: string;
  matcherVersion?: string;
  updatedAt: string;
}

export interface VenueCandidate {
  value: string;
  field: string;
  kindHint?: CCFKind;
  context?: string;
  /** venue 文本末尾自带的独立年份（如 "ICML 2026" 中的 2026）。 */
  yearHint?: string;
}

export interface VenueResolution {
  candidates: VenueCandidate[];
  isPreprint: boolean;
}

export interface MatchResult {
  status: "matched" | "none" | "unknown" | "preprint";
  source: "auto" | "manual";
  venueText?: string;
  rank?: CCFRank;
  abbr?: string;
  fullName?: string;
  category?: string;
  confidence?: number;
  matchedField?: string;
  matchedValue?: string;
  matchMethod?: string;
  /** 命中候选自带的年份标注；与条目 Date 字段无关。 */
  year?: string;
  /** 条目带 arXiv/preprint 信号且产生了 venue 判定；此时 Date 是提交日，不代表录取届次。 */
  preprintSignal?: boolean;
}
