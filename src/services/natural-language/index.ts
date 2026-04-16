import { normalizeText } from "./normalize";
import { tokenize } from "./tokenizer";
import { parseClauses } from "./clause-parser";
import { buildAST } from "./build-ast";
import { lowerToIR } from "./lower-ir";
import { compileToSuggestions } from "./compile";
import { validateAndDedupe } from "./validate";

import type {
  AttachmentNode,
  BaseScheduleNode,
  ClauseNode,
  DayTypeSpec,
  DurationSpec,
  NormalizedOverrideIntent,
  NormalizedPlanIntent,
  OverrideScheduleNode,
  PlanDraft,
  RecurrenceRule,
  RepeatSpec,
  ScheduleAST,
  ScheduleIR,
  Suggestion,
  TimeRangeSpec,
  TimeSpec,
  Token,
  UnresolvedField,
  Weekday,
  WeekdaySpec,
} from "./shared/types";

export interface NaturalLanguagePipelineResult {
  rawText: string;
  normalizedText: string;
  tokens: Token[];
  clauses: ClauseNode[];
  ast: ScheduleAST;
  ir: ScheduleIR;
  suggestions: Suggestion[];
}

function createEmptyPipelineResult(
  rawText: string
): NaturalLanguagePipelineResult {
  return {
    rawText,
    normalizedText: normalizeText(rawText),
    tokens: [],
    clauses: [],
    ast: {
      base: null,
      overrides: [],
      attachments: [],
      enumerations: [],
      diagnostics: [],
    },
    ir: {
      overrideIntents: [],
      diagnostics: [],
    },
    suggestions: [],
  };
}

export function runNaturalLanguagePipeline(
  rawText: string
): NaturalLanguagePipelineResult {
  const normalizedText = normalizeText(rawText);

  if (normalizedText.length === 0) {
    return createEmptyPipelineResult(rawText);
  }

  const tokens = tokenize(rawText);
  const clauses = parseClauses(rawText);
  const ast = buildAST(clauses);
  const ir = lowerToIR(ast);
  const compiled = compileToSuggestions(ir);
  const suggestions = validateAndDedupe(compiled);

  return {
    rawText,
    normalizedText,
    tokens,
    clauses,
    ast,
    ir,
    suggestions,
  };
}

export function parseNaturalLanguageSchedule(rawText: string): Suggestion[] {
  return runNaturalLanguagePipeline(rawText).suggestions;
}

export { normalizeText } from "./normalize";
export { tokenize } from "./tokenizer";
export { parseClauses } from "./clause-parser";
export { buildAST } from "./build-ast";
export { lowerToIR } from "./lower-ir";
export { compileToSuggestions } from "./compile";
export { validateAndDedupe } from "./validate";

export type {
  AttachmentNode,
  BaseScheduleNode,
  ClauseNode,
  DayTypeSpec,
  DurationSpec,
  NormalizedOverrideIntent,
  NormalizedPlanIntent,
  OverrideScheduleNode,
  PlanDraft,
  RecurrenceRule,
  RepeatSpec,
  ScheduleAST,
  ScheduleIR,
  Suggestion,
  TimeRangeSpec,
  TimeSpec,
  Token,
  UnresolvedField,
  Weekday,
  WeekdaySpec,
};
