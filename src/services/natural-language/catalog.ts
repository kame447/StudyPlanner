import { getNaturalLanguageCatalog } from "../../data/naturalLanguageCatalog";

interface CatalogSubjectMatch {
  label: string;
  keyword: string;
  priority: number;
  score: number;
}

interface CatalogTitleMatch {
  label: string;
  keyword: string;
  score: number;
}

const GENERIC_TITLE_LABELS = new Set([
  "数学",
  "英語",
  "物理",
  "化学",
  "情報",
  "演習",
  "復習",
  "振り返り",
  "自習",
  "現代文",
  "古文",
  "漢文",
]);

const SECONDARY_SUBJECT_LABELS = new Set(["演習", "復習", "振り返り", "自習"]);

function normalizeCatalogText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    )
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[Ⅰ]/g, "I")
    .replace(/[Ⅱ]/g, "II")
    .replace(/[Ⅲ]/g, "III");
}

function findBestSubjectMatch(text: string): CatalogSubjectMatch | undefined {
  const normalizedText = normalizeCatalogText(text);
  if (!normalizedText) {
    return undefined;
  }

  let bestMatch: CatalogSubjectMatch | undefined;

  for (const subject of getNaturalLanguageCatalog().subjects) {
    for (const keyword of subject.keywords) {
      const normalizedKeyword = normalizeCatalogText(keyword);

      if (!normalizedKeyword || !normalizedText.includes(normalizedKeyword)) {
        continue;
      }

      const score = normalizedKeyword.length;
      const priority = SECONDARY_SUBJECT_LABELS.has(subject.label) ? 1 : 2;
      if (
        !bestMatch ||
        priority > bestMatch.priority ||
        (priority === bestMatch.priority && score > bestMatch.score)
      ) {
        bestMatch = {
          label: subject.label,
          keyword,
          priority,
          score,
        };
      }
    }
  }

  return bestMatch;
}

function findBestTitleMatch(text: string): CatalogTitleMatch | undefined {
  const normalizedText = normalizeCatalogText(text);
  if (!normalizedText) {
    return undefined;
  }

  let bestMatch: CatalogTitleMatch | undefined;

  for (const subject of getNaturalLanguageCatalog().subjects) {
    for (const keyword of subject.keywords) {
      const normalizedKeyword = normalizeCatalogText(keyword);

      if (!normalizedKeyword || !normalizedText.includes(normalizedKeyword)) {
        continue;
      }

      const score = normalizedKeyword.length;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          label: subject.label,
          keyword,
          score,
        };
      }
    }
  }

  return bestMatch;
}

function toCanonicalSubjectLabel(label: string): string {
  switch (label) {
    case "現代文":
    case "古文":
    case "漢文":
      return "国語";
    default:
      return label;
  }
}

function canUseCatalogKeywordAsTitle(
  keyword: string,
  label: string,
  sourceText: string
): boolean {
  const normalizedKeyword = normalizeCatalogText(keyword);
  const normalizedSource = normalizeCatalogText(sourceText);

  if (!normalizedKeyword || !normalizedSource) {
    return false;
  }

  if (normalizedKeyword === normalizedSource) {
    return true;
  }

  if (GENERIC_TITLE_LABELS.has(label)) {
    return normalizedKeyword.length >= 4;
  }

  return normalizedKeyword.length >= 3;
}

export function inferCatalogSubject(text: string): string | undefined {
  const match = findBestSubjectMatch(text);
  if (!match) {
    return undefined;
  }

  return toCanonicalSubjectLabel(match.label);
}

export function inferCatalogTitle(text: string): string | undefined {
  const match = findBestTitleMatch(text);
  if (!match) {
    return undefined;
  }

  if (!canUseCatalogKeywordAsTitle(match.keyword, match.label, text)) {
    return undefined;
  }

  return match.keyword;
}
