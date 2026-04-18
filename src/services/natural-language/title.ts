import { inferCatalogTitle } from "./catalog";

const LEADING_TITLE_CONTEXT_PATTERNS = [
  /^(?:(?:寝る前|授業後|放課後|帰宅後)(?:に|は)?\s*)+/,
  /^(?:(?:軽く|少し|ちょっと)(?:だけ)?\s*)+/,
  /^(?:(?:だけ|のみ)\s*)+/,
  /^(?:(?:を|は|に)\s*)+/,
];

const TRAILING_EDGE_PATTERN = /(?:\s|　)*(?:を|は|に|で|が)+$/;
const GENERIC_SUBJECT_PREFIX_PATTERN =
  /^(数学|英語|物理|化学|情報|国語|現代文|古文|漢文|日本史|世界史|地理|政経|倫理|生物|地学)の(.+)$/;
const TASK_NOUN_PATTERN =
  /(?:課題|レポート|勉強|復習|振り返り|見直し|確認|修正|考察|小テスト|テスト|自習(?:時間)?|予定|演習|過去問(?:演習)?|ノート)$/;
const BROAD_TITLE_PATTERN =
  /^(?:勉強|学習|予定|課題|レポート|演習|復習|振り返り|自習(?:時間)?|確認|見直し|修正|考察|テスト)$/;

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
    regex: /^(.+?)(?:を書(?:いて|く))$/,
    project: (match) => match[1],
  },
  {
    regex: /^(.+?)を(?:やる|する|進める|勉強する|学習する|解く)(?:ようにしたい)?$/,
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

function isTaskNounPhrase(candidate: string): boolean {
  if (!candidate) {
    return false;
  }

  return TASK_NOUN_PATTERN.test(candidate);
}

function canonicalizeTaskNounPhrase(candidate: string): string {
  if (candidate === "自習") {
    return "自習時間";
  }

  return candidate;
}

function collapseRedundantTaskTitle(candidate: string): string {
  const match = /^(.+?)の勉強$/.exec(candidate);
  if (!match) {
    return candidate;
  }

  const head = cleanupCandidate(match[1]);
  if (!head || !isTaskNounPhrase(head)) {
    return candidate;
  }

  return canonicalizeTaskNounPhrase(head);
}

function maybeStripGenericSubjectPrefix(candidate: string): string {
  const match = GENERIC_SUBJECT_PREFIX_PATTERN.exec(candidate);
  if (!match) {
    return collapseRedundantTaskTitle(candidate);
  }

  const stripped = cleanupCandidate(match[2]);
  if (!stripped || isTaskNounPhrase(stripped)) {
    return collapseRedundantTaskTitle(candidate);
  }

  return collapseRedundantTaskTitle(stripped);
}

function isBroadTitleCandidate(candidate: string): boolean {
  return BROAD_TITLE_PATTERN.test(candidate);
}

function scoreTitleSpecificity(candidate: string): number {
  let score = candidate.length;

  if (isTaskNounPhrase(candidate)) {
    score += 8;
  }

  if (GENERIC_SUBJECT_PREFIX_PATTERN.test(candidate)) {
    score -= 4;
  }

  if (isBroadTitleCandidate(candidate)) {
    score -= 6;
  }

  return score;
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

    const candidate = maybeStripGenericSubjectPrefix(
      cleanupCandidate(pattern.project(match))
    );
    if (candidate) {
      return candidate;
    }
  }

  const candidate = maybeStripGenericSubjectPrefix(cleanupCandidate(normalized));
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
      lexicalCandidate !== catalogTitle
    ) {
      if (scoreTitleSpecificity(lexicalCandidate) >= scoreTitleSpecificity(catalogTitle)) {
        return lexicalCandidate;
      }

      return catalogTitle;
    }

    if (isReasonableTitleCandidate(lexicalCandidate)) {
      return lexicalCandidate;
    }

    if (catalogTitle) {
      return catalogTitle;
    }
  }

  return undefined;
}
