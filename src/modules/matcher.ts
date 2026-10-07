import ccfData from "../data/ccf-2026.json";
import highQualityJournalData from "../data/ccf-high-quality-journals-2025.json";
import { ccfVenueAugmentations } from "../data/ccfVenueAugmentations";
import {
  CCFDataFile,
  CCFKind,
  CCFVenue,
  MatchResult,
  VenueCandidate,
} from "./types";

interface IndexedVenue {
  venue: CCFVenue;
  normalizedFullName: string;
  aliases: string[];
  meaningfulTokens: Set<string>;
}

const internationalData = ccfData as CCFDataFile;
const chineseJournalData = highQualityJournalData as CCFDataFile;
const data: CCFDataFile = {
  version: `${internationalData.version}+${chineseJournalData.version}`,
  updateDate: chineseJournalData.updateDate,
  source: `${internationalData.source}; ${chineseJournalData.source}`,
  venues: [...internationalData.venues, ...chineseJournalData.venues],
};
const MATCHER_VERSION = "0.1.18-arxiv-comments-venue-hints";

const genericTokens = new Set([
  "acm",
  "and",
  "annual",
  "association",
  "computer",
  "conference",
  "ieee",
  "international",
  "journal",
  "meeting",
  "on",
  "of",
  "proceedings",
  "symposium",
  "the",
  "transactions",
  "workshop",
]);

const tokenExpansions: Record<string, string> = {
  adv: "advances",
  advances: "advances",
  advanced: "advanced",
  anal: "analysis",
  artif: "artificial",
  autom: "automation",
  bioinform: "bioinformatics",
  biomed: "biomedicine",
  comput: "computational",
  conf: "conference",
  cybern: "cybernetics",
  digit: "digital",
  electr: "electrical",
  eng: "engineering",
  inf: "information",
  inform: "information",
  int: "international",
  intell: "intelligence",
  lang: "language",
  linguist: "linguistics",
  mach: "machine",
  proc: "proceedings",
  process: "processing",
  res: "research",
  robot: "robotics",
  secur: "security",
  soc: "society",
  softw: "software",
  syst: "systems",
  technol: "technology",
  trans: "transactions",
};

function expandVenueTokens(value: string): string {
  return value
    .split(" ")
    .map((token) => tokenExpansions[token] || token)
    .join(" ");
}

function normalizeText(value: string): string {
  const normalized = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b([a-z]+)\s*['’]\d{2,4}\b/g, "$1")
    .replace(/[“”"'’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+/\-\s\u4e00-\u9fff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return expandVenueTokens(normalized);
}

function normalizeAbbr(value: string): string {
  return value
    .toUpperCase()
    .replace(/[“”"'’`]/g, "")
    .replace(/[^A-Z0-9+/\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripBoilerplate(value: string): string {
  let cleaned = value
    // OpenReview/论文页眉式样板前缀（如 "Published as a conference paper at ICLR 2023"）。
    // 注意：不要剥离 "workshop paper" 变体，workshop 标记必须保留给非主会防御逻辑。
    .replace(/^published as a conference paper at\s+/i, "")
    .replace(/^accepted as a (?:conference|regular) paper at\s+/i, "")
    .replace(/^published in\s+/, "")
    .replace(/^proceedings of (the )?/i, "")
    .replace(/^proc\.? of (the )?/i, "")
    .replace(/^proc\.?\s*-\s*/i, "")
    .replace(/^in:\s*/i, "")
    .replace(/^\d{4}\s+/, "")
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/g, " ")
    .replace(/\s*\(.*?\)\s*$/g, " ")
    .replace(/\s*,\s*(?:19|20)\d{2}\b/g, " ")
    .replace(/\s*,\s*vol(?:ume)?\.?\s*\d+\b/gi, " ")
    .replace(/\s*,\s*pp\.?\s*\d+.*$/gi, " ")
    .replace(/\s+(?:19|20)\d{2}\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 如果字符串较长且末尾是单纯的届数/卷号数字（如 "Advances in Neural Information Processing Systems 36"）
  if (cleaned.length > 12 && /\s+\d{1,3}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\s+\d{1,3}$/, "").trim();
  }
  return cleaned;
}

function getStrictNonMainMarkers(value: string): Set<string> {
  const normalized = normalizeText(value);
  const markers = new Set<string>();
  if (/\bfindings\b/.test(normalized)) markers.add("findings");
  if (/\bworkshops?\b/.test(normalized)) markers.add("workshop");
  if (/\bcompanion\b/.test(normalized)) markers.add("companion");
  if (/\bextended abstracts?\b/.test(normalized)) markers.add("extended");
  if (/\badjunct\b/.test(normalized)) markers.add("extended");
  return markers;
}

function extractExplicitAbbrs(value: string): string[] {
  const candidates = new Set<string>();

  for (const match of value.matchAll(/\(([A-Za-z][A-Za-z0-9+/-]{1,})\)/g)) {
    candidates.add(normalizeAbbr(match[1]));
  }

  const trailing = value.match(/,\s*([A-Za-z][A-Za-z0-9+/-]{1,})\s*$/);
  if (trailing?.[1]) {
    candidates.add(normalizeAbbr(trailing[1]));
  }

  return [...candidates].filter(Boolean);
}

function indexedVenueMentionsStrictMarker(
  indexed: IndexedVenue,
  marker: string,
): boolean {
  const values = [indexed.venue.fullName, ...(indexed.venue.aliases || [])];
  return values.some((value) => getStrictNonMainMarkers(value).has(marker));
}

function indexedVenueAllowsStrictMarkers(
  candidate: string,
  indexed: IndexedVenue,
): boolean {
  const markers = getStrictNonMainMarkers(candidate);
  if (markers.size === 0) return true;

  for (const marker of markers) {
    if (!indexedVenueMentionsStrictMarker(indexed, marker)) {
      return false;
    }
  }
  return true;
}

function candidateExplicitlyRejectsVenue(
  candidate: string,
  indexed: IndexedVenue,
  kindHint?: CCFKind,
): boolean {
  const normalized = normalizeText(candidate);
  const abbr = normalizeAbbr(candidate).replace(/\s+/g, "");
  const venueAbbr = indexed.venue.abbr;

  if (venueAbbr === "AI" && kindHint && kindHint !== "journal") {
    return true;
  }

  if (
    venueAbbr === "ICMI" &&
    /\bcomputing and machine intelligence\b/.test(normalized)
  ) {
    return true;
  }

  if (venueAbbr === "ICRA" && /\bicrai\b/i.test(candidate)) {
    return true;
  }

  if (
    venueAbbr === "TSE" &&
    (/\bvfast\b/.test(normalized) ||
      /\bsoftware engineering and methodology\b/.test(normalized))
  ) {
    return true;
  }

  if (
    venueAbbr === "JBI" &&
    /\bcomputing and biomedical informatics\b/.test(normalized)
  ) {
    return true;
  }

  if (venueAbbr === "TOPS" && /\bieee security and privacy\b/.test(normalized)) {
    return true;
  }

  if (
    venueAbbr === "TOIS" &&
    (/\bneural\b/.test(normalized) ||
      /\badvances in neural\b/.test(normalized) ||
      /\bneurips\b/.test(normalized) ||
      /\bnips\b/.test(normalized))
  ) {
    return true;
  }

  if (
    venueAbbr === "ICONIP" &&
    (/\bsystems\b/.test(normalized) ||
      /\bneurips\b/.test(normalized) ||
      /\bnips\b/.test(normalized))
  ) {
    return true;
  }

  return Boolean(venueAbbr === "ICRA" && abbr === "ICRAI");
}

function candidateCanMatchIndexed(
  candidate: string,
  indexed: IndexedVenue,
): boolean {
  return (
    indexedVenueAllowsStrictMarkers(candidate, indexed) &&
    !candidateExplicitlyRejectsVenue(candidate, indexed)
  );
}

function explicitAbbrSupportsVenue(
  explicitAbbrs: string[],
  indexed: IndexedVenue,
): boolean {
  if (explicitAbbrs.length === 0) return true;
  const aliases = new Set(
    indexed.aliases.map((alias) => alias.replace(/\s+/g, "")),
  );
  return explicitAbbrs.some((abbr) => aliases.has(abbr.replace(/\s+/g, "")));
}

function tokenizeMeaningful(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !genericTokens.has(token)),
  );
}

function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function generateAliases(venue: CCFVenue): string[] {
  const aliases = new Set<string>();
  const augs = [
    ...(ccfVenueAugmentations[venue.fullName] || []),
    ...(ccfVenueAugmentations[venue.abbr] || []),
  ];
  const rawAliases = [venue.abbr, venue.fullName, ...(venue.aliases || []), ...augs];

  for (const alias of rawAliases) {
    const normalizedText = normalizeText(alias);
    if (normalizedText) {
      aliases.add(normalizedText);
      if (!containsCjk(normalizedText)) {
        aliases.add(normalizedText.replace(/\s+/g, ""));
      }
    }

    const normalized = normalizeAbbr(alias);
    if (!normalized) continue;
    aliases.add(normalized);
    aliases.add(normalized.replace(/\s+/g, ""));

    const prefixPattern = /^(INTERNATIONAL|IEEE|ACM|THE)\s+/;
    let stripped = normalized;
    while (prefixPattern.test(stripped)) {
      stripped = stripped.replace(prefixPattern, "").trim();
      if (stripped.length >= 2) {
        aliases.add(stripped);
        aliases.add(stripped.replace(/\s+/g, ""));
      }
    }
  }

  // Common community shorthand that differs from the official CCF abbreviation.
  if (venue.abbr === "SIGKDD") {
    aliases.add("KDD");
  }

  return [...aliases].filter(Boolean);
}

function buildIndex() {
  const venues = data.venues;
  const indexed = venues.map((venue) => ({
    venue,
    normalizedFullName: normalizeText(venue.fullName),
    aliases: generateAliases(venue),
    meaningfulTokens: tokenizeMeaningful(venue.fullName),
  }));

  const aliasMap = new Map<string, IndexedVenue[]>();
  const fullNameMap = new Map<string, IndexedVenue[]>();

  for (const entry of indexed) {
    const fullEntries = fullNameMap.get(entry.normalizedFullName) || [];
    fullEntries.push(entry);
    fullNameMap.set(entry.normalizedFullName, fullEntries);

    for (const alias of entry.aliases) {
      const entries = aliasMap.get(alias) || [];
      entries.push(entry);
      aliasMap.set(alias, entries);
    }
  }

  return { indexed, aliasMap, fullNameMap };
}

const index = buildIndex();
const ambiguousBareAbbrs = new Set(["AI"]);

function stripOrdinalsAndYears(value: string): string {
  return value
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, " ")
    .replace(
      /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth)\b/gi,
      " ",
    )
    .replace(/\bannual\b/gi, " ")
    .replace(/\binternational\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveCanonicalVenueQueries(value: string): string[] {
  const queries = new Set<string>();
  const normalized = normalizeText(value);
  const abbr = normalizeAbbr(value);

  if (getStrictNonMainMarkers(value).size > 0) {
    return [];
  }

  if (
    /\b(ACM\s+)?WEB\s+CONFERENCE\b/.test(abbr) ||
    /\bTHE\s+WEB\s+CONFERENCE\b/.test(abbr) ||
    /\bWWW\s+20\d{2}\b/.test(abbr)
  ) {
    queries.add("WWW");
    queries.add("International World Wide Web Conference");
  }

  if (/\bINFOCOM\b/.test(abbr) && /\b(IEEE|PROC|PROCEEDINGS)\b/.test(abbr)) {
    queries.add("INFOCOM");
  }

  const mentionsNaacl =
    /\bnorth american chapter\b/.test(normalized) ||
    /\bnations of the americas chapter\b/.test(normalized);
  const mentionsAclOrg =
    /\bassociation\b/.test(normalized) ||
    /\bcomputational linguistics\b/.test(normalized);
  if (mentionsNaacl && mentionsAclOrg) {
    queries.add("NAACL");
  }

  if (
    /\b(advances in neural information processing systems|neural information processing systems)\b/i.test(
      value,
    ) ||
    /\b(neurips|nips)\s*(?:19|20)?\d{2}\b/i.test(value) ||
    /\badv\.?\s*neural\s*inf\.?\s*process\.?\s*syst\.?\b/i.test(value)
  ) {
    queries.add("NeurIPS");
    queries.add("Advances in Neural Information Processing Systems");
    queries.add("Conference on Neural Information Processing Systems");
  }

  if (
    /\b(proceedings of machine learning research|pmlr)\b/i.test(value) ||
    /\bint(ernational)?\s+conf(erence)?\s+on\s+machine\s+learning\b/i.test(value)
  ) {
    queries.add("ICML");
    queries.add("International Conference on Machine Learning");
  }

  if (
    /\b(proceedings of the vldb endowment|pvldb)\b/i.test(value) ||
    /\bproc\.?\s+vldb\s+endow\.?\b/i.test(value)
  ) {
    queries.add("VLDB");
    queries.add("International Conference on Very Large Data Bases");
  }

  if (
    /\b(ieee\/cvf\s+)?(computer\s+vision\s+and\s+pattern\s+recognition|cvpr)\b/i.test(
      value,
    )
  ) {
    queries.add("CVPR");
    queries.add("IEEE/CVF Computer Vision and Pattern Recognition Conference");
  }

  if (
    /\b(sigkdd|kdd)\s*(?:19|20)?\d{2}\b/i.test(value) ||
    /\bknowledge\s+discovery\s+and\s+data\s+mining\b/i.test(value)
  ) {
    queries.add("SIGKDD");
    queries.add("KDD");
  }

  if (
    /\b(interactive,\s*mobile,\s*wearable\s*and\s*ubiquitous\s*technologies|imwut)\b/i.test(
      value,
    )
  ) {
    queries.add("UbiComp");
    queries.add("IMWUT");
  }

  const strippedOrdinal = stripOrdinalsAndYears(value);
  if (strippedOrdinal && strippedOrdinal !== value) {
    queries.add(strippedOrdinal);
  }

  return [...queries].filter((query) => query !== value);
}

function containsAlias(normalizedCandidate: string, alias: string): boolean {
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return false;
  if (containsCjk(normalizedAlias)) {
    return normalizedCandidate === normalizedAlias;
  }
  const escaped = normalizedAlias
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return re.test(normalizedCandidate);
}

function scoreVenue(
  candidate: string,
  normalizedCandidate: string,
  indexed: IndexedVenue,
  kindHint?: CCFKind,
): number {
  let score = 0;
  const kindMatches = Boolean(kindHint && indexed.venue.kind === kindHint);
  const kindMismatch = Boolean(kindHint && indexed.venue.kind !== kindHint);

  const explicitAbbrs = extractExplicitAbbrs(candidate);
  const explicitAbbrConflict = !explicitAbbrSupportsVenue(
    explicitAbbrs,
    indexed,
  );
  const hasExplicitAbbrSupport =
    explicitAbbrs.length > 0 && !explicitAbbrConflict;

  if (candidateExplicitlyRejectsVenue(candidate, indexed, kindHint)) {
    return 0;
  }
  if (explicitAbbrConflict) {
    return 0;
  }
  if (!indexedVenueAllowsStrictMarkers(candidate, indexed)) {
    return 0;
  }

  // 1. 全称精确匹配：1000分
  if (normalizedCandidate === indexed.normalizedFullName) {
    return 1000 + (kindMatches ? 20 : 0);
  }

  const candidateAbbr = normalizeAbbr(candidate);
  // 2. 别名精确匹配：950 - 980 分
  for (const alias of indexed.aliases) {
    const normAlias = normalizeText(alias);
    if (normalizedCandidate === normAlias) {
      return 980 + (kindMatches ? 20 : 0);
    }
    if (candidateAbbr === normalizeAbbr(alias)) {
      return 950 + (kindMatches ? 20 : 0);
    }
  }

  // 3. 全称安全包含匹配
  const safeFullNameContainment = indexed.meaningfulTokens.size >= 3;
  const candidateTokens = tokenizeMeaningful(candidate);
  if (
    !kindMismatch &&
    safeFullNameContainment &&
    normalizedCandidate.includes(indexed.normalizedFullName)
  ) {
    let matchedInCandidate = 0;
    for (const t of candidateTokens) {
      if (indexed.meaningfulTokens.has(t)) matchedInCandidate++;
    }
    const unconsumed = candidateTokens.size - matchedInCandidate;
    if (unconsumed <= 2) {
      score = Math.max(score, 850 - unconsumed * 30 + (kindMatches ? 20 : 0));
    }
  }

  // 4. 别名包含匹配
  for (const alias of indexed.aliases) {
    const normAlias = normalizeText(alias);
    if (!kindMismatch && normAlias.length >= 4 && containsAlias(normalizedCandidate, normAlias)) {
      const aliasTokens = tokenizeMeaningful(alias);
      if (aliasTokens.size >= 1) {
        let matched = 0;
        for (const t of candidateTokens) {
          if (aliasTokens.has(t)) matched++;
        }
        const unconsumed = candidateTokens.size - matched;
        if (unconsumed <= 2) {
          score = Math.max(
            score,
            750 - unconsumed * 30 + (kindMatches ? 60 : 0) + (hasExplicitAbbrSupport ? 100 : 0),
          );
        }
      }
    }
  }

  // 5. 模糊关键词重叠打分：类型冲突时严禁跨类型模糊匹配
  if (kindMismatch) {
    return score;
  }

  let overlap = 0;
  for (const token of candidateTokens) {
    if (indexed.meaningfulTokens.has(token)) {
      overlap += 1;
    }
  }

  const venueTokenCount = indexed.meaningfulTokens.size;
  const candidateTokenCount = candidateTokens.size;
  const unconsumedTokens = candidateTokenCount - overlap;

  const precision = candidateTokenCount > 0 ? overlap / candidateTokenCount : 0;
  const recall = venueTokenCount > 0 ? overlap / venueTokenCount : 0;

  // 核心防御：短刊名（<= 2 词，如 TOIS: information, systems）若无显式缩写支持，严禁低精度或高未消耗词的模糊匹配
  if (
    venueTokenCount <= 2 &&
    !hasExplicitAbbrSupport &&
    (precision < 0.65 || unconsumedTokens > 1)
  ) {
    return score;
  }

  const requiredOverlap = venueTokenCount <= 2 ? 2 : 3;
  if (overlap >= requiredOverlap && precision >= 0.55 && recall >= 0.6) {
    const f1 = (2 * precision * recall) / (precision + recall);
    const base = venueTokenCount <= 2 && indexed.normalizedFullName.split(" ").length >= 4 ? 540 : 500;
    const tokenScore = Math.round(
      base + f1 * 250 - unconsumedTokens * 60 + (kindMatches ? 60 : 0) + (hasExplicitAbbrSupport ? 100 : 0),
    );
    if (tokenScore > score) {
      score = tokenScore;
    }
  }

  return score;
}

function pickBest(
  entries: IndexedVenue[],
  candidate: string,
  kindHint?: CCFKind,
): IndexedVenue | undefined {
  let candidatePool = entries;
  if (kindHint) {
    const matchingKind = entries.filter(
      (entry) => entry.venue.kind === kindHint,
    );
    if (matchingKind.length > 0) {
      candidatePool = matchingKind;
    } else {
      // 歧义裸缩写（如 "AI"）严禁跨类型容错
      if (ambiguousBareAbbrs.has(candidate.trim().toUpperCase())) {
        return undefined;
      }
      candidatePool = entries;
    }
  }

  const allowedEntries = candidatePool.filter((entry) =>
    candidateCanMatchIndexed(candidate, entry),
  );
  if (allowedEntries.length === 0) return undefined;
  if (allowedEntries.length === 1) return allowedEntries[0];

  const normalizedCandidate = normalizeText(candidate);
  const scored = allowedEntries
    .map((entry) => ({
      entry,
      score: scoreVenue(candidate, normalizedCandidate, entry, kindHint),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score <= 0) return undefined;

  return best.entry;
}

export function findVenue(
  value: string,
  kindHint?: CCFKind,
): MatchResult | undefined {
  const stripped = stripBoilerplate(value);
  if (!stripped) return undefined;

  const queries = [
    stripped,
    ...deriveCanonicalVenueQueries(value),
    ...deriveCanonicalVenueQueries(stripped),
  ];
  const uniqueQueries = [...new Set(queries)];
  for (const query of uniqueQueries) {
    const match = findVenueFromQuery(query, kindHint, stripped);
    if (match) return match;
  }

  return undefined;
}

function findVenueFromQuery(
  query: string,
  kindHint: CCFKind | undefined,
  venueText: string,
): MatchResult | undefined {
  const stripped = stripBoilerplate(query);
  if (!stripped) return undefined;

  const normalized = normalizeText(stripped);
  const abbr = normalizeAbbr(stripped);

  const exactAlias = abbr
    ? pickBest(index.aliasMap.get(abbr) || [], stripped, kindHint)
    : undefined;
  if (exactAlias) {
    return toMatchResult(exactAlias, venueText, 1, "精确简称/别名匹配");
  }

  const compactAlias = abbr
    ? pickBest(
        index.aliasMap.get(abbr.replace(/\s+/g, "")) || [],
        stripped,
        kindHint,
      )
    : undefined;
  if (compactAlias) {
    return toMatchResult(compactAlias, venueText, 0.98, "紧凑简称/别名匹配");
  }

  const exactTextAlias = pickBest(
    index.aliasMap.get(normalized) || [],
    stripped,
    kindHint,
  );
  if (exactTextAlias) {
    return toMatchResult(exactTextAlias, venueText, 0.98, "精确文本别名匹配");
  }

  const exactFull = pickBest(
    index.fullNameMap.get(normalized) || [],
    stripped,
    kindHint,
  );
  if (exactFull) {
    return toMatchResult(exactFull, venueText, 0.96, "精确全称匹配");
  }

  const leadingToken = stripped.match(/^([A-Za-z][A-Za-z0-9+/-]{1,})\b/);
  if (leadingToken) {
    const token = normalizeAbbr(leadingToken[1]);
    const leadingAlias = pickBest(
      index.aliasMap.get(token) || [],
      stripped,
      kindHint,
    );
    if (leadingAlias) {
      return toMatchResult(leadingAlias, venueText, 0.92, "开头简称匹配");
    }
  }

  let best: { entry: IndexedVenue; score: number } | undefined;
  for (const entry of index.indexed) {
    const score = scoreVenue(stripped, normalized, entry, kindHint);
    if (!best || score > best.score) {
      best = { entry, score };
    }
  }

  if (best && best.score >= 780) {
    return toMatchResult(
      best.entry,
      venueText,
      Math.min(best.score / 1000, 0.9),
      "受限模糊匹配",
    );
  }

  return undefined;
}

export function matchCandidates(
  candidates: VenueCandidate[],
  isPreprint: boolean,
): MatchResult {
  for (const candidate of candidates) {
    const match = findVenue(candidate.value, candidate.kindHint);
    if (match) {
      if (!candidateSupportsAmbiguousBareAbbr(candidate, match)) {
        continue;
      }
      if (
        candidate.context &&
        isAbbreviationCandidate(candidate.value) &&
        !contextSupportsMatch(match, candidate.context)
      ) {
        continue;
      }
      return {
        ...match,
        matchedField: candidate.field,
        matchedValue: candidate.value,
        matchMethod: describeCandidateMatch(candidate, match.matchMethod),
      };
    }
  }

  if (isPreprint) {
    return {
      status: "preprint",
      source: "auto",
      venueText: "arXiv",
      confidence: 1,
      matchMethod: "预印本信号",
    };
  }

  const firstVenue = candidates.find((candidate) => candidate.value.trim());
  if (firstVenue) {
    return {
      status: "none",
      source: "auto",
      venueText: firstVenue.value,
      confidence: 0.5,
      matchedField: firstVenue.field,
      matchedValue: firstVenue.value,
      matchMethod: "有明确 venue，但未命中 CCF 目录",
    };
  }

  return {
      status: "unknown",
      source: "auto",
      confidence: 0,
      matchMethod: "没有足够 venue 线索",
  };
}

export function getVenueCount() {
  return data.venues.length;
}

export function getCatalogVersion() {
  return data.version;
}

export function getMatcherVersion() {
  return MATCHER_VERSION;
}

export function getVenues(): CCFVenue[] {
  return data.venues;
}

function toMatchResult(
  indexed: IndexedVenue,
  venueText: string,
  confidence: number,
  matchMethod: string,
): MatchResult {
  return {
    status: "matched",
    source: "auto",
    rank: indexed.venue.rank,
    abbr: indexed.venue.abbr,
    fullName: indexed.venue.fullName,
    category: indexed.venue.category,
    venueText,
    confidence,
    matchMethod,
  };
}

function describeCandidateMatch(
  candidate: VenueCandidate,
  matcherMethod?: string,
): string {
  if (candidate.field === "identifier:acl-anthology") {
    return `ACL Anthology DOI/URL 线索 + ${matcherMethod || "本地匹配"}`;
  }
  if (candidate.field === "extra:comments") {
    return `Comments 接收声明 + ${matcherMethod || "本地匹配"}`;
  }
  if (candidate.field === "identifier:doi-prefix") {
    return `DOI 前缀线索 + ${matcherMethod || "本地匹配"}`;
  }
  if (candidate.field === "identifier") {
    return `URL/标识符线索 + ${matcherMethod || "本地匹配"}`;
  }
  if (candidate.field.endsWith(":abbr")) {
    return `字段中的显式简称 + ${matcherMethod || "本地匹配"}`;
  }
  if (candidate.field === "title") {
    return `标题括号简称 + ${matcherMethod || "本地匹配"}`;
  }
  if (candidate.field === "extra") {
    return `Extra 中的 venue 线索 + ${matcherMethod || "本地匹配"}`;
  }
  return `${candidate.field} 字段 + ${matcherMethod || "本地匹配"}`;
}

function isAbbreviationCandidate(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z][A-Za-z0-9+/-]{1,15}$/.test(trimmed);
}

function contextSupportsMatch(match: MatchResult, context: string): boolean {
  if (match.status !== "matched" || !match.fullName) return true;

  const normalizedContext = normalizeText(context);
  const normalizedFullName = normalizeText(match.fullName);
  if (
    normalizedFullName &&
    match.fullName.split(/\s+/).length >= 3 &&
    normalizedContext.includes(normalizedFullName)
  ) {
    return true;
  }

  const contextTokens = tokenizeMeaningful(context);
  const fullTokens = tokenizeMeaningful(match.fullName);
  if (fullTokens.size === 0) return true;

  let overlap = 0;
  for (const token of fullTokens) {
    if (contextTokens.has(token)) overlap += 1;
  }

  const required = fullTokens.size <= 2 ? fullTokens.size : 2;
  return overlap >= required;
}

function candidateSupportsAmbiguousBareAbbr(
  candidate: VenueCandidate,
  match: MatchResult,
): boolean {
  if (match.status !== "matched" || !match.abbr || !match.fullName) return true;

  const candidateAbbr = normalizeAbbr(stripBoilerplate(candidate.value)).replace(
    /\s+/g,
    "",
  );
  if (!ambiguousBareAbbrs.has(match.abbr) || candidateAbbr !== match.abbr) {
    return true;
  }

  const normalizedCandidate = normalizeText(candidate.value);
  const normalizedFullName = normalizeText(match.fullName);
  if (normalizedCandidate === normalizedFullName) return true;

  const field = candidate.field.toLowerCase();
  const isJournalField =
    field === "publicationtitle" || field === "journalabbreviation";
  if (candidate.kindHint === "journal" && isJournalField) return true;

  const context = normalizeText(`${candidate.value} ${candidate.context || ""}`);
  return Boolean(normalizedFullName && context.includes(normalizedFullName));
}
