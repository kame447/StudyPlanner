import { normalizeText } from "./normalize";
import { tokenize } from "./tokenizer";
import type { ClauseNode, Token } from "./shared/types";

function splitSegments(input: string): string[] {
  const normalized = normalizeText(input);

  return normalized
    .split(/[。\n;；]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function hasToken(tokens: Token[], kind: Token["kind"]): boolean {
  return tokens.some((token) => token.kind === kind);
}

function isOverrideClause(tokens: Token[]): boolean {
  return hasToken(tokens, "OVERRIDE");
}

function isEnumerationClause(segment: string): boolean {
  return (
    /\d+回/.test(segment) && /(1回は|１回は|もう1回|もう１回)/.test(segment)
  );
}

function isTimeOnlyClause(segment: string, tokens: Token[]): boolean {
  const hasTime = hasToken(tokens, "TIME") || hasToken(tokens, "TIME_RANGE");
  const hasOtherStructuredSignal =
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

function isInstructionClause(tokens: Token[]): boolean {
  const hasStructuredSignal = tokens.some(
    (token) =>
      token.kind === "TIME" ||
      token.kind === "TIME_RANGE" ||
      token.kind === "DURATION" ||
      token.kind === "REPEAT" ||
      token.kind === "WEEKDAY" ||
      token.kind === "DAYTYPE" ||
      token.kind === "OVERRIDE"
  );

  return !hasStructuredSignal;
}

function classifySegment(segment: string): ClauseNode {
  const tokens = tokenize(segment);

  if (isOverrideClause(tokens)) {
    return { kind: "OverrideClause", tokens, spanText: segment };
  }

  if (isEnumerationClause(segment)) {
    return { kind: "EnumerationClause", tokens, spanText: segment };
  }

  if (isTimeOnlyClause(segment, tokens)) {
    return { kind: "TimeOnlyClause", tokens, spanText: segment };
  }

  if (isInstructionClause(tokens)) {
    return { kind: "InstructionClause", tokens, spanText: segment };
  }

  return { kind: "EventClause", tokens, spanText: segment };
}

export function parseClauses(input: string): ClauseNode[] {
  return splitSegments(input).map(classifySegment);
}
