import { normalizeText } from "./normalize";
import { tokenize } from "./tokenizer";
import { parseClauses } from "./clause-parser";
import { buildAST } from "./build-ast";
import { lowerToIR } from "./lower-ir";
import { compileToSuggestions } from "./compile";
import { validateAndDedupe } from "./validate";

import type {
  ClauseNode,
  PipelineOptions,
  ScheduleAST,
  ScheduleIR,
  Suggestion,
  Token,
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
      sequences: [],
      overrides: [],
      attachments: [],
      enumerations: [],
      diagnostics: [],
    },
    ir: {
      sequencedIntents: [],
      enumeratedIntents: [],
      overrideIntents: [],
      diagnostics: [],
    },
    suggestions: [],
  };
}

export function runNaturalLanguagePipeline(
  rawText: string,
  options: PipelineOptions = {}
): NaturalLanguagePipelineResult {
  const normalizedText = normalizeText(rawText);

  if (normalizedText.length === 0) {
    return createEmptyPipelineResult(rawText);
  }

  const tokens = tokenize(rawText);
  const clauses = parseClauses(rawText);
  const ast = buildAST(clauses);
  const ir = lowerToIR(ast, options);
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

export function parseNaturalLanguageSchedule(
  rawText: string,
  options: PipelineOptions = {}
): Suggestion[] {
  return runNaturalLanguagePipeline(rawText, options).suggestions;
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
  DateSpec,
  DayTypeSpec,
  DurationSpec,
  EnumerationVariantNode,
  NormalizedEnumerationIntent,
  NormalizedOverrideIntent,
  NormalizedPlanIntent,
  NormalizedSequencedIntent,
  OverrideScheduleNode,
  PipelineOptions,
  PlanDraft,
  RecurrenceRule,
  RelativeDaySpec,
  RepeatSpec,
  SequenceRelation,
  SequencedEventNode,
  UnresolvedField,
  WeekScopeSpec,
  Weekday,
  WeekdaySpec,
} from "./shared/types";
