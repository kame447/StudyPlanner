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

interface EventSubjectSources {
  titleText?: string;
  contentText?: string;
  rawText?: string;
  contextText?: string;
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

function inferCorrectedSubjectFromText(text: string): string | undefined {
  const normalized = normalizeCatalogText(text);
  if (!normalized) {
    return undefined;
  }

  if (/現代文|古文|漢文|古典|古文単語/.test(text)) {
    return "国語";
  }

  if (/情報.*(?:課題|レポート)|(?:課題|レポート).*情報/.test(text)) {
    return "情報";
  }

  if (/良問の風|物理/.test(text)) {
    return "物理";
  }

  if (/黄色チャート|青チャート|チャート式|数学/.test(text)) {
    return "数学";
  }

  if (/TOEIC|英単語|英語長文|英文法|リスニング|システム英単語|ターゲット1900/.test(text)) {
    return "英語";
  }

  if (/過去問(?:演習)?|演習/.test(text)) {
    return "演習";
  }

  if (/振り返り/.test(text)) {
    return "振り返り";
  }

  if (/自習(?:時間)?/.test(text)) {
    return "自習";
  }

  if (/勉強(?:予定)?|学習/.test(text)) {
    return "勉強";
  }

  if (/復習/.test(text)) {
    return "復習";
  }

  if (normalized.includes("toeic")) {
    return "英語";
  }

  return undefined;
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

export function inferEventSubject({
  titleText,
  contentText,
  rawText,
  contextText,
}: EventSubjectSources): string | undefined {
  for (const sourceText of [titleText, contentText, rawText, contextText]) {
    if (!sourceText) {
      continue;
    }

    const corrected = inferCorrectedSubjectFromText(sourceText);
    if (corrected) {
      return corrected;
    }
  }

  const localJoined = [titleText, contentText, rawText, contextText]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");

  if (!localJoined) {
    return undefined;
  }

  return inferCatalogSubject(localJoined);
}
