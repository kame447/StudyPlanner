import { normalizeText } from "./normalize";
import { tokenize } from "./tokenizer";
import type { ClauseNode, Token } from "./shared/types";

function splitSentences(input: string): string[] {
  const normalized = normalizeText(input);

  return normalized
    .split(/[。\n;；]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function hasToken(tokens: Token[], kind: Token["kind"]): boolean {
  return tokens.some((token) => token.kind === kind);
}

function hasAnyStructuredEventSignal(tokens: Token[]): boolean {
  return tokens.some(
    (token) =>
      token.kind === "DATE" ||
      token.kind === "TIME" ||
      token.kind === "TIME_RANGE" ||
      token.kind === "DURATION" ||
      token.kind === "REPEAT" ||
      token.kind === "WEEKDAY" ||
      token.kind === "DAYTYPE" ||
      token.kind === "CONNECTIVE"
  );
}

function isBreakLikeInstructionClause(segment: string, tokens: Token[]): boolean {
  const hasBlockingStructuredSignal =
    hasToken(tokens, "DATE") ||
    hasToken(tokens, "TIME") ||
    hasToken(tokens, "TIME_RANGE") ||
    hasToken(tokens, "REPEAT") ||
    hasToken(tokens, "WEEKDAY") ||
    hasToken(tokens, "DAYTYPE") ||
    hasToken(tokens, "OVERRIDE");

  if (hasBlockingStructuredSignal || !hasToken(tokens, "DURATION")) {
    return false;
  }

  return /休憩|休ん|休み|休息|ブレイク/.test(segment);
}

function isOverrideClause(tokens: Token[]): boolean {
  return hasToken(tokens, "OVERRIDE");
}

function isEnumerationClause(segment: string): boolean {
  return (
    /\d+回/.test(segment) && /(1回は|１回は|もう1回|もう１回)/.test(segment)
  );
}

function isEnumerationBaseClause(segment: string): boolean {
  return (
    /\d+回/.test(segment) && !/(1回は|１回は|もう1回|もう１回)/.test(segment)
  );
}

function isTimeOnlyClause(segment: string, tokens: Token[]): boolean {
  const hasTime = hasToken(tokens, "TIME") || hasToken(tokens, "TIME_RANGE");
  const hasOtherStructuredSignal =
    hasToken(tokens, "DATE") ||
    hasToken(tokens, "DURATION") ||
    hasToken(tokens, "REPEAT") ||
    hasToken(tokens, "WEEKDAY") ||
    hasToken(tokens, "DAYTYPE") ||
    hasToken(tokens, "OVERRIDE");

  if (!hasTime || hasOtherStructuredSignal) {
    return false;
  }

  const compact = segment.replace(/\s+/g, "");

  return /^(?:時間は?|時刻は?|開始は?|開始時刻は?)?\d{1,2}:\d{2}(?:(?:-|から)\d{1,2}:\d{2})?(?:で)?$/.test(
    compact
  );
}

function startsNewExplicitTimedClause(segment: string): boolean {
  const tokens = tokenize(segment);

  if (
    tokens.length === 0 ||
    isTimeOnlyClause(segment, tokens) ||
    !(hasToken(tokens, "TIME") || hasToken(tokens, "TIME_RANGE"))
  ) {
    return false;
  }

  const firstStructuredToken = tokens.find((token) => token.kind !== "CONTENT");

  return (
    firstStructuredToken?.kind === "DATE" ||
    firstStructuredToken?.kind === "TIME" ||
    firstStructuredToken?.kind === "TIME_RANGE" ||
    firstStructuredToken?.kind === "CONNECTIVE"
  );
}

function splitSentenceIntoSegments(sentence: string): string[] {
  const parts = sentence
    .split(/[、,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return parts;
  }

  const segments: string[] = [];
  let current = "";

  for (const part of parts) {
    if (current.length === 0) {
      current = part;
      continue;
    }

    const tokens = tokenize(part);
    if (
      startsNewExplicitTimedClause(part) ||
      isBreakLikeInstructionClause(part, tokens)
    ) {
      segments.push(current);
      current = part;
      continue;
    }

    current = `${current}、${part}`;
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function isLikelyStudyEventClause(segment: string): boolean {
  return /(英語|数学|国語|理科|社会|長文|文法|単語|復習|勉強|学習)/.test(
    segment
  );
}

function isInstructionClause(segment: string, tokens: Token[]): boolean {
  if (isBreakLikeInstructionClause(segment, tokens)) {
    return true;
  }

  if (hasAnyStructuredEventSignal(tokens)) {
    return false;
  }

  if (isEnumerationBaseClause(segment)) {
    return false;
  }

  if (isLikelyStudyEventClause(segment)) {
    return false;
  }

  return true;
}

function classifySegment(segment: string, sentenceIndex: number): ClauseNode {
  const tokens = tokenize(segment);

  if (isOverrideClause(tokens)) {
    return { kind: "OverrideClause", tokens, spanText: segment, sentenceIndex };
  }

  if (isEnumerationClause(segment)) {
    return { kind: "EnumerationClause", tokens, spanText: segment, sentenceIndex };
  }

  if (isTimeOnlyClause(segment, tokens)) {
    return { kind: "TimeOnlyClause", tokens, spanText: segment, sentenceIndex };
  }

  if (isInstructionClause(segment, tokens)) {
    return { kind: "InstructionClause", tokens, spanText: segment, sentenceIndex };
  }

  return { kind: "EventClause", tokens, spanText: segment, sentenceIndex };
}

export function parseClauses(input: string): ClauseNode[] {
  return splitSentences(input).flatMap((sentence, sentenceIndex) =>
    splitSentenceIntoSegments(sentence).map((segment) =>
      classifySegment(segment, sentenceIndex)
    )
  );
}
