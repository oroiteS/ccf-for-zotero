import { CCFKind, VenueCandidate, VenueResolution } from "./types";

const inputFingerprintFields = [
  "title",
  "publicationTitle",
  "proceedingsTitle",
  "conferenceName",
  "journalAbbreviation",
  "seriesTitle",
  "DOI",
  "url",
  "extra",
  "archiveID",
  "repository",
  "libraryCatalog",
];

function getField(item: Zotero.Item, field: string): string {
  try {
    const value = item.getField(field);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function addCandidate(
  candidates: VenueCandidate[],
  value: string,
  field: string,
  kindHint?: CCFKind,
  context?: string,
) {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (
    candidates.some(
      (candidate) => candidate.value === trimmed && candidate.field === field,
    )
  ) {
    return;
  }
  candidates.push({ value: trimmed, field, kindHint, context });
}

function hasWorkshopMarker(value: string): boolean {
  return /\bworkshops?\b/i.test(value) || /\bCVPR\d{4}W\b/i.test(value);
}

function extractBracketAbbr(value: string): string[] {
  const results = new Set<string>();
  for (const match of value.matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1].trim();
    if (/^[A-Za-z][A-Za-z0-9+/-]{1,}$/.test(inner)) {
      results.add(inner);
      continue;
    }
    const yearMatch = inner.match(
      /^([A-Za-z][A-Za-z0-9+/-]{1,})\s*['’]?(?:19|20)?\d{2}$/,
    );
    if (yearMatch?.[1]) {
      results.add(yearMatch[1]);
      results.add(inner);
    }
  }
  return [...results];
}

function extractTrailingAbbr(value: string): string[] {
  const matches = [
    ...value.matchAll(/,\s*([A-Za-z][A-Za-z0-9+/-]{1,})\s*$/g),
  ];
  return matches.map((match) => match[1]);
}

function addVenueField(
  candidates: VenueCandidate[],
  value: string,
  field: string,
  kindHint?: CCFKind,
) {
  const trimmed = value.trim();
  if (!trimmed) return;

  if (!hasWorkshopMarker(trimmed)) {
    for (const abbr of [
      ...extractBracketAbbr(trimmed),
      ...extractTrailingAbbr(trimmed),
    ]) {
      addCandidate(candidates, abbr, `${field}:abbr`, kindHint, trimmed);
    }
  }

  addCandidate(candidates, trimmed, field, kindHint);
}

function extractExtraVenues(extra: string): string[] {
  const venues: string[] = [];
  const pattern =
    /^\s*(venue|conference|journal|booktitle|proceedings|publication)\s*[:=]\s*(.+)$/i;
  for (const line of extra.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match?.[2]) venues.push(match[2]);
  }
  return venues;
}

// Zotero 的 arXiv translator 会把 arXiv 页面的 Comments 字段以 "Comments: ..."
// 行的形式存进 Extra。ML 领域论文常在这里写接收声明，
// 如 "Accepted as ICLR 2026 Oral"、"To appear in ICML 2025"。
const extraCommentsPattern = /^\s*comments?\s*[:=]\s*(.+)$/i;
const commentsExclusionPattern =
  /\bunder\s+review\b|\bsubmitted\b|\brejected\b|\bwithdrawn\b|\bin\s+submission\b|\bunder\s+consideration\b/i;
const commentsAcceptancePattern =
  /\b(?:accepted|published|to\s+appear|appearing|forthcoming)\b\s+(?:as\s+|to\s+|at\s+|in\s+|by\s+|for\s+)?(?:an?\s+)?(?:conference\s+|journal\s+|workshop\s+)?(?:papers?\s+)?(?:at\s+|in\s+|to\s+|by\s+|for\s+)?\s*([^,;.()[\]\n]+)/i;
const commentsPresentationSuffixPattern =
  /\s+(?:orals?|spotlights?|posters?|papers?|talks?|highlights?|presentations?|contributions?)\s*$/i;

/**
 * 从 Extra 的 "Comments:" 行中提取接收/发表声明里的出版物名称。
 * 只在存在明确接受措辞时产生候选，纯元信息（"17 pages, 3 figures"）
 * 与未发表声明（"Under review at ..."）不会产生候选。
 */
function extractExtraCommentsVenueHints(extra: string): string[] {
  if (!extra) return [];
  const hints: string[] = [];
  for (const line of extra.split(/\r?\n/)) {
    const commentMatch = line.match(extraCommentsPattern);
    if (!commentMatch?.[1]) continue;
    const comment = commentMatch[1];
    if (commentsExclusionPattern.test(comment)) continue;

    const acceptanceMatch = comment.match(commentsAcceptancePattern);
    if (!acceptanceMatch?.[1]) continue;

    const phrase = acceptanceMatch[1]
      .trim()
      .replace(/\s+/g, " ")
      .replace(commentsPresentationSuffixPattern, "")
      .trim();
    if (phrase) hints.push(phrase);
  }
  return hints;
}

function isPreprint(item: Zotero.Item): boolean {
  const fields = [
    "archiveID",
    "repository",
    "libraryCatalog",
    "DOI",
    "url",
    "extra",
  ];
  return fields.some((field) =>
    getField(item, field).toLowerCase().includes("arxiv"),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getItemInputFingerprint(item: Zotero.Item): string {
  const payload = {
    itemType: item.itemType || "",
    fields: inputFingerprintFields.map((field) => [
      field,
      getField(item, field).replace(/\s+/g, " ").trim(),
    ]),
  };
  return `v1:${stableHash(JSON.stringify(payload))}`;
}

function extractDoiVenuePrefix(value: string): string[] {
  const matches = [
    ...value.matchAll(/\b10\.1109\/([A-Za-z][A-Za-z0-9+_-]*)/gi),
  ];
  return matches
    .map((match) => match[1].replace(/[0-9].*$/, "").toUpperCase())
    .filter((prefix) => prefix.length >= 3);
}

function extractAclAnthologyHints(value: string): string[] {
  const hints: string[] = [];
  const matches = [
    ...value.matchAll(
      /\b(?:10\.18653\/v1\/)?(20\d{2})\.([a-z]+(?:-[a-z]+)*)\.\d+\b/gi,
    ),
  ];

  for (const match of matches) {
    const year = match[1];
    const code = match[2].toLowerCase();
    const findings = code.match(/^findings-(acl|emnlp|naacl|eacl|coling)$/);
    if (findings?.[1]) {
      hints.push(
        `Findings of the Association for Computational Linguistics: ${findings[1].toUpperCase()} ${year}`,
      );
      continue;
    }

    if (/^acl-(long|short|main)$/.test(code)) {
      hints.push("ACL");
    } else if (code === "emnlp-main") {
      hints.push("EMNLP");
    } else if (/^naacl-(long|short|main)$/.test(code)) {
      hints.push("NAACL");
    } else if (code === "coling-main") {
      hints.push("COLING");
    } else if (/^eacl-(long|short|main)$/.test(code)) {
      hints.push("EACL");
    }
  }

  return unique(hints);
}

function getVenueContext(item: Zotero.Item): string {
  return [
    "conferenceName",
    "proceedingsTitle",
    "publicationTitle",
    "journalAbbreviation",
    "seriesTitle",
    "extra",
  ]
    .map((field) => getField(item, field))
    .filter(Boolean)
    .join(" ");
}

function addIdentifierHints(candidates: VenueCandidate[], item: Zotero.Item) {
  const identifierText = ["DOI", "url", "extra"]
    .map((field) => getField(item, field))
    .join(" ");
  const normalizedIdentifierText = identifierText.toLowerCase();
  const venueContext = getVenueContext(item);

  for (const hint of extractAclAnthologyHints(normalizedIdentifierText)) {
    addCandidate(candidates, hint, "identifier:acl-anthology", "conference");
  }

  if (/cvpr\d{4}w\b|_cvprw_\d{4}_paper/.test(normalizedIdentifierText)) {
    addCandidate(candidates, "CVPR Workshops", "identifier", "conference");
  } else if (
    /cvpr\d{4}\/html|_cvpr_\d{4}_paper/.test(normalizedIdentifierText)
  ) {
    addCandidate(candidates, "CVPR", "identifier", "conference", venueContext);
  }

  for (const prefix of extractDoiVenuePrefix(identifierText)) {
    addCandidate(candidates, prefix, "identifier:doi-prefix");
  }
}

export function resolveVenueCandidates(item: Zotero.Item): VenueResolution {
  const candidates: VenueCandidate[] = [];
  const itemType = item.itemType;

  if (itemType === "conferencePaper") {
    addVenueField(
      candidates,
      getField(item, "proceedingsTitle"),
      "proceedingsTitle",
      "conference",
    );
    addVenueField(
      candidates,
      getField(item, "conferenceName"),
      "conferenceName",
      "conference",
    );
    addVenueField(
      candidates,
      getField(item, "publicationTitle"),
      "publicationTitle",
      "conference",
    );
    addVenueField(
      candidates,
      getField(item, "seriesTitle"),
      "seriesTitle",
      "conference",
    );
  } else if (itemType === "journalArticle") {
    addVenueField(
      candidates,
      getField(item, "publicationTitle"),
      "publicationTitle",
      "journal",
    );
    addVenueField(
      candidates,
      getField(item, "journalAbbreviation"),
      "journalAbbreviation",
      "journal",
    );
    addVenueField(
      candidates,
      getField(item, "seriesTitle"),
      "seriesTitle",
      "journal",
    );
  } else {
    addVenueField(
      candidates,
      getField(item, "publicationTitle"),
      "publicationTitle",
    );
    addVenueField(
      candidates,
      getField(item, "journalAbbreviation"),
      "journalAbbreviation",
      "journal",
    );
    addVenueField(candidates, getField(item, "seriesTitle"), "seriesTitle");
  }

  for (const abbr of extractBracketAbbr(getField(item, "title"))) {
    addCandidate(candidates, abbr, "title");
  }

  for (const venue of extractExtraVenues(getField(item, "extra"))) {
    addVenueField(candidates, venue, "extra");
  }

  for (const hint of extractExtraCommentsVenueHints(getField(item, "extra"))) {
    addCandidate(candidates, hint, "extra:comments");
  }

  addIdentifierHints(candidates, item);

  return {
    candidates,
    isPreprint: isPreprint(item),
  };
}
