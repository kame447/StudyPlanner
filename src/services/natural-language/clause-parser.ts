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
      token.kind === "SET_COUNT" ||
      token.kind === "REPEAT" ||
      token.kind === "WEEKDAY" ||
      token.kind === "WEEKDAY_GROUP" ||
      token.kind === "DAYTYPE" ||
      token.kind === "CONNECTIVE"
  );
}

function contentParts(tokens: Token[]): string[] {
  return tokens
    .filter((token) => token.kind === "CONTENT")
    .map((token) => token.raw.trim())
    .filter((value) => value.length > 0);
}

function isScaffoldContent(text: string): boolean {
  return /^(?:は|を|に|で|が|の|と|から|まで|だけ|のみ|へ|より|日|曜日)+$/.test(
    text.replace(/\s+/g, ""),
  );
}

function hasMeaningfulContent(tokens: Token[]): boolean {
  const parts = contentParts(tokens);

  if (parts.length === 0) {
    return false;
  }

  return parts.some((part) => !isScaffoldContent(part));
}

function isBreakLikeInstructionClause(segment: string, tokens: Token[]): boolean {
  const hasBlockingStructuredSignal =
    hasToken(tokens, "DATE") ||
    hasToken(tokens, "TIME") ||
    hasToken(tokens, "TIME_RANGE") ||
    hasToken(tokens, "REPEAT") ||
    hasToken(tokens, "WEEKDAY") ||
    hasToken(tokens, "WEEKDAY_GROUP") ||
    hasToken(tokens, "DAYTYPE") ||
    hasToken(tokens, "OVERRIDE");

  if (
    hasBlockingStructuredSignal ||
    !(hasToken(tokens, "DURATION") || hasToken(tokens, "REST"))
  ) {
    return false;
  }

  return /休憩|休ん|休み|休息|ブレイク/.test(segment);
}

function hasOtherDaysCue(tokens: Token[]): boolean {
  return tokens.some(
    (token) => token.kind === "OVERRIDE" && /^(?:他の日は|他は)$/.test(token.raw),
  );
}

function isImplicitOverrideClause(segment: string, tokens: Token[]): boolean {
  if (hasToken(tokens, "OVERRIDE")) {
    return false;
  }

  if (hasToken(tokens, "REPEAT") || hasToken(tokens, "DAYTYPE")) {
    return false;
  }

  if (
    !(hasToken(tokens, "WEEKDAY") || hasToken(tokens, "WEEKDAY_GROUP")) ||
    !(hasToken(tokens, "TIME") || hasToken(tokens, "TIME_RANGE") || hasToken(tokens, "DURATION"))
  ) {
    return false;
  }

  return /(?:だけ|のみ)/.test(segment.replace(/\s+/g, ""));
}

function isReverseOrderBaseClause(tokens: Token[]): boolean {
  if (!hasOtherDaysCue(tokens)) {
    return false;
  }

  return (
    hasToken(tokens, "REPEAT") ||
    hasToken(tokens, "DAYTYPE") ||
    hasToken(tokens, "TIME") ||
    hasToken(tokens, "TIME_RANGE") ||
    hasToken(tokens, "DURATION")
  );
}

function isOverrideClause(segment: string, tokens: Token[]): boolean {
  if (isReverseOrderBaseClause(tokens)) {
    return false;
  }

  return hasToken(tokens, "OVERRIDE") || isImplicitOverrideClause(segment, tokens);
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
  const hasTimeOrDuration =
    hasToken(tokens, "TIME") ||
    hasToken(tokens, "TIME_RANGE") ||
    hasToken(tokens, "DURATION");
  const hasOtherStructuredSignal =
    hasToken(tokens, "DATE") ||
    hasToken(tokens, "REPEAT") ||
    hasToken(tokens, "WEEKDAY") ||
    hasToken(tokens, "WEEKDAY_GROUP") ||
    hasToken(tokens, "DAYTYPE") ||
    hasToken(tokens, "OVERRIDE");

  if (!hasTimeOrDuration || hasOtherStructuredSignal) {
    return false;
  }

  const compact = segment.replace(/\s+/g, "");

  if (
    /^(?:時間は?|時刻は?|開始は?|開始時刻は?)?\d{1,2}:\d{2}(?:(?:-|から)\d{1,2}:\d{2})?(?:で)?$/.test(
      compact
    )
  ) {
    return true;
  }

  if (
    !hasMeaningfulContent(tokens) &&
    /(?:\d{1,2}:\d{2}|\d+\s*(?:分|時間|時間半))/.test(compact)
  ) {
    return true;
  }

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
    firstStructuredToken?.kind === "CONNECTIVE" ||
    (firstStructuredToken?.kind === "OVERRIDE" && isReverseOrderBaseClause(tokens))
  );
}

function isScopeOnlySegment(segment: string): boolean {
  const tokens = tokenize(segment);
  const hasScopeSignal =
    hasToken(tokens, "DATE") ||
    hasToken(tokens, "WEEKDAY") ||
    hasToken(tokens, "WEEKDAY_GROUP") ||
    hasToken(tokens, "DAYTYPE") ||
    hasToken(tokens, "REPEAT");
  const hasTimeSignal =
    hasToken(tokens, "TIME") ||
    hasToken(tokens, "TIME_RANGE") ||
    hasToken(tokens, "DURATION") ||
    hasToken(tokens, "REST");

  return hasScopeSignal && !hasTimeSignal && !hasMeaningfulContent(tokens);
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
    if (isScopeOnlySegment(current) && startsNewExplicitTimedClause(part)) {
      current = `${current}、${part}`;
      continue;
    }

    if (
      startsNewExplicitTimedClause(part) ||
      isBreakLikeInstructionClause(part, tokens) ||
      isTimeOnlyClause(part, tokens) ||
      isScheduleControlClause(part, tokens)
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

function isSupplementInstructionClause(segment: string, tokens: Token[]): boolean {
  const compact = segment.replace(/\s+/g, "");

  if (/^(?:内容|補足|メモ)は/.test(compact)) {
    return true;
  }

  if (
    /^合計\d+(?:分|時間)(?:だけ)?(?:やりたい|したい|で)?$/.test(compact)
  ) {
    return true;
  }

  if (
    /として固定して$/.test(compact) &&
    !hasToken(tokens, "TIME") &&
    !hasToken(tokens, "TIME_RANGE") &&
    !hasToken(tokens, "DATE")
  ) {
    return true;
  }

  if (
    /(合計\d+(?:分|時間)|やりたい|したい|割り振って)/.test(compact) &&
    !hasToken(tokens, "TIME") &&
    !hasToken(tokens, "TIME_RANGE")
  ) {
    return true;
  }

  return false;
}

function isScheduleControlClause(segment: string, tokens: Token[]): boolean {
  const compact = segment.replace(/\s+/g, "");
  const hasDateOrRecurrenceSignal =
    hasToken(tokens, "DATE") ||
    hasToken(tokens, "REPEAT") ||
    hasToken(tokens, "WEEKDAY") ||
    hasToken(tokens, "WEEKDAY_GROUP") ||
    hasToken(tokens, "DAYTYPE") ||
    hasToken(tokens, "OVERRIDE");
  const hasTimeSignal =
    hasToken(tokens, "TIME") ||
    hasToken(tokens, "TIME_RANGE") ||
    hasToken(tokens, "DURATION") ||
    hasToken(tokens, "REST");

  if (
    !hasToken(tokens, "CONTROL") &&
    !hasToken(tokens, "SET_COUNT") &&
    !hasOtherDaysCue(tokens)
  ) {
    return false;
  }

  if (
    !hasMeaningfulContent(tokens) &&
    (hasToken(tokens, "TIME") ||
      hasToken(tokens, "TIME_RANGE") ||
      hasToken(tokens, "DURATION") ||
      hasToken(tokens, "REST"))
  ) {
    return true;
  }

  if (hasToken(tokens, "SET_COUNT") && !hasDateOrRecurrenceSignal && !hasTimeSignal) {
    return true;
  }

  if (hasToken(tokens, "CONTROL") && !hasDateOrRecurrenceSignal && !hasTimeSignal) {
    return true;
  }

  return /^(?:全部|ずつ|ようにしたい|やるようにしたい|にして|固定して|休みにして|やりたい|したい)+$/.test(
    compact,
  );
}

function isInstructionClause(segment: string, tokens: Token[]): boolean {
  if (isBreakLikeInstructionClause(segment, tokens)) {
    return true;
  }

  if (isSupplementInstructionClause(segment, tokens)) {
    return true;
  }

  if (isScheduleControlClause(segment, tokens)) {
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

  if (isOverrideClause(segment, tokens)) {
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
