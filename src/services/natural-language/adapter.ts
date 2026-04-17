import {
  summarizeLegacyRepeatFromRecurrenceRules,
  summarizeLegacyRepeatUntilFromRecurrenceRules,
} from "../../lib/planRecurrence";
import { buildDefaultPlanTitle } from "../../lib/plans";
import type {
  MonthEventRepeat,
  NaturalLanguageSuggestion,
  PlanDraft as LegacyPlanDraft,
  PlanType,
  RecurrenceRule as LegacyRecurrenceRule,
  SuggestionField,
} from "../../types/domain";
import { detectSubject, detectType, type SuggestionInput } from "../naturalLanguageRules";
import { runNaturalLanguagePipeline } from "./index";
import type {
  PipelineOptions,
  Suggestion as PipelineSuggestion,
  UnresolvedField,
  Weekday,
} from "./shared/types";

export type NaturalLanguageRulesPipelineMode =
  | "legacy"
  | "pipeline"
  | "hybrid";

const RULES_PIPELINE_MODE_STORAGE_KEY = "studyplanner.nl.rules.pipeline.mode";
const RULES_PIPELINE_MODE_VALUES: NaturalLanguageRulesPipelineMode[] = [
  "legacy",
  "pipeline",
  "hybrid",
];

function isRulesPipelineMode(
  value: string | undefined | null,
): value is NaturalLanguageRulesPipelineMode {
  return (
    typeof value === "string" &&
    RULES_PIPELINE_MODE_VALUES.includes(
      value as NaturalLanguageRulesPipelineMode,
    )
  );
}

function readGlobalRulesPipelineMode():
  | NaturalLanguageRulesPipelineMode
  | undefined {
  const maybeGlobal = (
    globalThis as typeof globalThis & {
      __STUDYPLANNER_NL_RULES_PIPELINE_MODE__?: string;
    }
  ).__STUDYPLANNER_NL_RULES_PIPELINE_MODE__;

  return isRulesPipelineMode(maybeGlobal) ? maybeGlobal : undefined;
}

function readStoredRulesPipelineMode():
  | NaturalLanguageRulesPipelineMode
  | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const stored = window.localStorage.getItem(RULES_PIPELINE_MODE_STORAGE_KEY);
    return isRulesPipelineMode(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

export function getNaturalLanguageRulesPipelineMode(): NaturalLanguageRulesPipelineMode {
  const globalMode = readGlobalRulesPipelineMode();
  if (globalMode) {
    return globalMode;
  }

  const envMode = import.meta.env.VITE_NL_RULES_PIPELINE_MODE;
  if (isRulesPipelineMode(envMode)) {
    return envMode;
  }

  const storedMode = readStoredRulesPipelineMode();
  if (storedMode) {
    return storedMode;
  }

  return "legacy";
}

function mapUnresolvedFields(
  fields: UnresolvedField[],
): SuggestionField[] {
  return [...fields];
}

function toLegacyWeekdays(weekdays: Weekday[] | undefined): LegacyRecurrenceRule["weekdays"] {
  if (!weekdays || weekdays.length === 0) {
    return [];
  }

  return weekdays.map((weekday) => weekday);
}

function toLegacyRecurrenceRules(
  suggestion: PipelineSuggestion,
  fallbackDate: string,
  type: PlanType,
  title: string,
  subject: string,
): LegacyRecurrenceRule[] {
  const startDate = suggestion.parsedPlan.date ?? fallbackDate;
  const startTime = suggestion.parsedPlan.startTime ?? "";
  const endTime = suggestion.parsedPlan.endTime ?? "";

  return (suggestion.parsedPlan.recurrenceRules ?? []).map((rule, index) => ({
    id: `pipeline-rule-${index}`,
    kind: rule.kind,
    startDate,
    until: null,
    dates: [],
    weekdays: toLegacyWeekdays(rule.weekdays),
    dayType: rule.dayType ?? null,
    startTime,
    endTime,
    title,
    subject,
    type,
    memo: "",
    isOverride: false,
  }));
}

function inferLegacyType(
  suggestion: PipelineSuggestion,
  input: SuggestionInput,
): PlanType {
  return detectType(
    [
      suggestion.parsedPlan.title,
      suggestion.parsedPlan.subject,
      suggestion.parsedPlan.contentText,
      suggestion.rawText,
      input.text,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function inferLegacySubject(
  suggestion: PipelineSuggestion,
  input: SuggestionInput,
): string {
  return (
    suggestion.parsedPlan.subject ||
    detectSubject(
      [
        suggestion.parsedPlan.title,
        suggestion.parsedPlan.contentText,
        suggestion.rawText,
        input.text,
      ]
        .filter(Boolean)
        .join(" "),
    ) ||
    ""
  );
}

function inferLegacyTitle(
  suggestion: PipelineSuggestion,
  type: PlanType,
  subject: string,
): string {
  return (
    suggestion.parsedPlan.title ||
    suggestion.parsedPlan.contentText ||
    buildDefaultPlanTitle(type, subject)
  );
}

function inferConfidence(suggestion: PipelineSuggestion): number {
  if (typeof suggestion.confidence === "number") {
    return suggestion.confidence;
  }

  const unresolvedPenalty = suggestion.unresolvedFields.length * 0.08;
  return Math.max(0.55, 0.92 - unresolvedPenalty);
}

function inferStatus(
  unresolvedFields: SuggestionField[],
): NaturalLanguageSuggestion["status"] {
  return unresolvedFields.length > 0 ? "needs_review" : "ready";
}

export function adaptPipelineSuggestionToLegacySuggestion(
  suggestion: PipelineSuggestion,
  input: SuggestionInput,
): NaturalLanguageSuggestion {
  const type = inferLegacyType(suggestion, input);
  const subject = inferLegacySubject(suggestion, input);
  const title = inferLegacyTitle(suggestion, type, subject);
  const recurrenceRules = toLegacyRecurrenceRules(
    suggestion,
    suggestion.parsedPlan.date ?? input.selectedDate,
    type,
    title,
    subject,
  );
  const repeat =
    summarizeLegacyRepeatFromRecurrenceRules(recurrenceRules) ?? "none";
  const repeatUntil = summarizeLegacyRepeatUntilFromRecurrenceRules(
    recurrenceRules,
    null,
  );
  const unresolvedFields = mapUnresolvedFields(suggestion.unresolvedFields);
  const parsedPlan: LegacyPlanDraft = {
    userId: input.userId,
    title,
    subject,
    date: suggestion.parsedPlan.date ?? input.selectedDate,
    startTime: suggestion.parsedPlan.startTime ?? "",
    endTime: suggestion.parsedPlan.endTime ?? "",
    repeat: repeat as MonthEventRepeat,
    repeatUntil,
    excludedDates: [],
    recurrenceRules,
    type,
    memo: "",
  };

  return {
    mode: input.mode,
    rawText: suggestion.rawText,
    confidence: inferConfidence(suggestion),
    reason: "新しいルールベース pipeline から構造化した追加案です。",
    source: "rules",
    providerLabel: "ルールベース",
    status: inferStatus(unresolvedFields),
    parsedPlan,
    assumptions: [
      ...suggestion.assumptions,
      "new pipeline adapter を経由して既存 planner 形式へ変換しました。",
    ],
    unresolvedFields,
    issues: [],
  };
}

export function adaptPipelineSuggestionsToLegacySuggestions(
  suggestions: PipelineSuggestion[],
  input: SuggestionInput,
): NaturalLanguageSuggestion[] {
  return suggestions.map((suggestion) =>
    adaptPipelineSuggestionToLegacySuggestion(suggestion, input),
  );
}

export function runRulesPipelineThroughAdapter(
  input: SuggestionInput,
  options: PipelineOptions = {},
): NaturalLanguageSuggestion[] {
  const result = runNaturalLanguagePipeline(input.text, {
    referenceDate: input.selectedDate,
    ...options,
  });

  return adaptPipelineSuggestionsToLegacySuggestions(result.suggestions, input);
}
