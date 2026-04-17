import { inferCatalogTitle } from "./catalog";

const LEADING_TITLE_CONTEXT_PATTERNS = [
  /^(?:(?:今日|明日|明後日|今週|来週)(?:の|は|に)?\s*)+/,
  /^(?:(?:朝|午前|午後|昼|夕方|夜)(?:は|に)?\s*)+/,
  /^(?:(?:寝る前|授業後|放課後|帰宅後)(?:に|は)?\s*)+/,
  /^(?:(?:軽く|少し|ちょっと)(?:だけ)?\s*)+/,
  /^(?:(?:だけ|のみ)\s*)+/,
  /^(?:(?:を|は|に)\s*)+/,
];

const TRAILING_EDGE_PATTERN = /(?:\s|　)*(?:を|は|に|で|が)+$/;

const REWRITE_PATTERNS: Array<{
  regex: RegExp;
  project: (match: RegExpExecArray) => string;
}> = [
  {
    regex: /^(.+?)を(?:軽く|少し|ちょっと|だけ)?復習(?:する)?$/,
    project: (match) => `${match[1]}の復習`,
  },
  {
    regex: /^(.+?)を(?:軽く|少し|ちょっと|だけ)?見直す$/,
    project: (match) => `${match[1]}の見直し`,
  },
  {
    regex: /^(.+?)を(?:軽く|少し|ちょっと|だけ)?確認する$/,
    project: (match) => `${match[1]}の確認`,
  },
  {
    regex: /^(.+?)を(?:軽く|少し|ちょっと|だけ)?修正する$/,
    project: (match) => `${match[1]}の修正`,
  },
  {
    regex: /^(.+?)を書く$/,
    project: (match) => match[1],
  },
  {
    regex: /^(.+?)を(?:やる|する|進める|勉強する|学習する|解く)$/,
    project: (match) => match[1],
  },
];

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripLeadingTitleContext(text: string): string {
  let normalized = normalizeWhitespace(text);
  let changed = true;

  while (changed) {
    changed = false;

    for (const pattern of LEADING_TITLE_CONTEXT_PATTERNS) {
      const next = normalized.replace(pattern, "").trim();
      if (next !== normalized) {
        normalized = next;
        changed = true;
      }
    }
  }

  return normalized;
}

function stripTrailingEdges(text: string): string {
  return text.replace(TRAILING_EDGE_PATTERN, "").trim();
}

function cleanupCandidate(candidate: string): string {
  return stripTrailingEdges(normalizeWhitespace(candidate));
}

function buildLexicalTitleCandidate(text: string): string | undefined {
  const normalized = stripLeadingTitleContext(text);
  if (!normalized) {
    return undefined;
  }

  for (const pattern of REWRITE_PATTERNS) {
    const match = pattern.regex.exec(normalized);
    if (!match) {
      continue;
    }

    const candidate = cleanupCandidate(pattern.project(match));
    if (candidate) {
      return candidate;
    }
  }

  const candidate = cleanupCandidate(normalized);
  return candidate || undefined;
}

function isReasonableTitleCandidate(candidate: string | undefined): candidate is string {
  if (!candidate) {
    return false;
  }

  if (candidate.length === 0 || candidate.length > 40) {
    return false;
  }

  if (
    /^(?:朝|午前|午後|昼|夕方|夜|寝る前|授業後|放課後|帰宅後|軽く|少し|ちょっと|だけ)$/.test(
      candidate,
    )
  ) {
    return false;
  }

  if (
    /(?:やる|する|進める|勉強する|学習する|解く|入れて|固定して)$/.test(candidate)
  ) {
    return false;
  }

  return true;
}

export function inferEventTitle(
  contentText?: string,
  contextText?: string,
): string | undefined {
  for (const sourceText of [contentText, contextText]) {
    if (!sourceText) {
      continue;
    }

    const lexicalCandidate = buildLexicalTitleCandidate(sourceText);
    const catalogTitle =
      inferCatalogTitle(sourceText) ??
      inferCatalogTitle(stripLeadingTitleContext(sourceText));

    if (
      isReasonableTitleCandidate(lexicalCandidate) &&
      catalogTitle &&
      lexicalCandidate !== catalogTitle &&
      lexicalCandidate.includes(catalogTitle) &&
      lexicalCandidate.length > catalogTitle.length + 2
    ) {
      return lexicalCandidate;
    }

    if (catalogTitle) {
      return catalogTitle;
    }

    if (isReasonableTitleCandidate(lexicalCandidate)) {
      return lexicalCandidate;
    }
  }

  return undefined;
}
