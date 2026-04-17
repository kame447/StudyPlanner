import {
  getFirstRecurrenceOccurrenceDate,
  normalizeRecurrenceRules,
  summarizeLegacyRepeatFromRecurrenceRules,
  summarizeLegacyRepeatUntilFromRecurrenceRules,
} from "../../lib/planRecurrence";
import { addDays, startOfWeek } from "../../lib/date";
import { buildDefaultPlanTitle } from "../../lib/plans";
import type {
  MonthEventRepeat,
  NaturalLanguageSuggestion,
  PlanDraft as LegacyPlanDraft,
  Plan,
  PlanType,
  RecurrenceRule as LegacyRecurrenceRule,
  SuggestionField,
} from "../../types/domain";
import {
  detectSubject,
  detectType,
  generateRuleBasedSuggestion,
  matchPlan,
  type SuggestionInput,
} from "../naturalLanguageRules";
import { runNaturalLanguagePipeline } from "./index";
import type {
  PipelineOptions,
  Suggestion as PipelineSuggestion,
  UnresolvedField,
  Weekday,
} from "./shared/types";

const ALL_WEEKDAYS: Weekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

const BUSINESS_WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
const WEEKEND_WEEKDAYS: Weekday[] = ["sat", "sun"];

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

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function parseRepeatUntilFromText(
  text: string,
  anchorDate: string,
): string | null {
  const baseYear = Number(anchorDate.slice(0, 4));
  const explicitDateMatch = text.match(/(\d{1,2})月(\d{1,2})日まで/);

  if (explicitDateMatch) {
    const month = explicitDateMatch[1].padStart(2, "0");
    const day = explicitDateMatch[2].padStart(2, "0");
    return `${baseYear}-${month}-${day}`;
  }

  const slashDateMatch = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})まで/);

  if (slashDateMatch) {
    return `${slashDateMatch[1]}-${slashDateMatch[2].padStart(2, "0")}-${slashDateMatch[3].padStart(2, "0")}`;
  }

  const monthOnlyMatch = text.match(/(\d{1,2})月中/);

  if (monthOnlyMatch) {
    const month = Number(monthOnlyMatch[1]);
    return `${baseYear}-${month.toString().padStart(2, "0")}-${daysInMonth(baseYear, month)
      .toString()
      .padStart(2, "0")}`;
  }

  if (/来週末まで/.test(text)) {
    return addDays(startOfWeek(anchorDate), 13);
  }

  if (/今週末まで/.test(text)) {
    return addDays(startOfWeek(anchorDate), 6);
  }

  return null;
}

function subtractWeekdays(
  source: Weekday[],
  excluded: Weekday[] | undefined,
): Weekday[] {
  if (!excluded || excluded.length === 0) {
    return source;
  }

  return source.filter((weekday) => !excluded.includes(weekday));
}

function convertPipelineRuleToLegacyShape(
  rule: NonNullable<PipelineSuggestion["parsedPlan"]["recurrenceRules"]>[number],
): {
  kind: LegacyRecurrenceRule["kind"];
  dayType: LegacyRecurrenceRule["dayType"];
  weekdays: LegacyRecurrenceRule["weekdays"];
  dates: string[];
  assumptions: string[];
} | null {
  const assumptions: string[] = [];

  if (rule.kind === "date") {
    return {
      kind: "date",
      dayType: null,
      weekdays: [],
      dates: rule.dates?.filter(isIsoDate) ?? [],
      assumptions,
    };
  }

  if (rule.kind === "weekday") {
    return {
      kind: "weekday",
      dayType: null,
      weekdays: toLegacyWeekdays(rule.weekdays),
      dates: [],
      assumptions,
    };
  }

  if (rule.kind === "day-type") {
    if (rule.dayType === "weekday" && rule.excludedWeekdays?.length) {
      assumptions.push(
        "pipeline recurrence の平日例外を曜日列に展開して legacy 形式へ変換しました。",
      );
      return {
        kind: "weekday",
        dayType: null,
        weekdays: toLegacyWeekdays(
          subtractWeekdays(BUSINESS_WEEKDAYS, rule.excludedWeekdays),
        ),
        dates: [],
        assumptions,
      };
    }

    if (rule.dayType === "weekend" && rule.excludedWeekdays?.length) {
      assumptions.push(
        "pipeline recurrence の週末例外を曜日列に展開して legacy 形式へ変換しました。",
      );
      return {
        kind: "weekday",
        dayType: null,
        weekdays: toLegacyWeekdays(
          subtractWeekdays(WEEKEND_WEEKDAYS, rule.excludedWeekdays),
        ),
        dates: [],
        assumptions,
      };
    }

    return {
      kind: "day-type",
      dayType: rule.dayType ?? null,
      weekdays: [],
      dates: [],
      assumptions,
    };
  }

  if (rule.kind === "daily") {
    if (rule.excludedWeekdays?.length) {
      assumptions.push(
        "pipeline recurrence の毎日例外を曜日列に展開して legacy 形式へ変換しました。",
      );
      return {
        kind: "weekday",
        dayType: null,
        weekdays: toLegacyWeekdays(
          subtractWeekdays(ALL_WEEKDAYS, rule.excludedWeekdays),
        ),
        dates: [],
        assumptions,
      };
    }

    return {
      kind: "daily",
      dayType: null,
      weekdays: [],
      dates: [],
      assumptions,
    };
  }

  return null;
}

function buildLegacyRecurrencePayload(
  suggestion: PipelineSuggestion,
  input: SuggestionInput,
  fallbackDate: string,
  type: PlanType,
  title: string,
  subject: string,
): {
  recurrenceRules: LegacyRecurrenceRule[];
  repeatUntil: string | null;
  representativeDate: string;
  assumptions: string[];
} {
  const parsedRules = suggestion.parsedPlan.recurrenceRules ?? [];
  const anchorDate = suggestion.parsedPlan.date ?? fallbackDate;
  const startTime = suggestion.parsedPlan.startTime ?? "";
  const endTime = suggestion.parsedPlan.endTime ?? "";
  const inferredUntil = parseRepeatUntilFromText(suggestion.rawText, anchorDate);
  const assumptions: string[] = [];

  const mappedLegacyRules = parsedRules.map((rule, index) => {
        const converted = convertPipelineRuleToLegacyShape(rule);

        if (!converted) {
          assumptions.push(
            `pipeline recurrence rule ${index + 1} は legacy 形式へ完全変換できなかったため一部を補完しました。`,
          );
          return null;
        }

        assumptions.push(...converted.assumptions);

        return {
          id:
            typeof rule.id === "string" && rule.id.trim().length > 0
              ? rule.id.trim()
              : `pipeline-rule-${index + 1}`,
          kind: converted.kind,
          startDate:
            (isIsoDate(rule.startDate) && rule.startDate) ||
            suggestion.parsedPlan.date ||
            fallbackDate,
          until:
            (isIsoDate(rule.until) && rule.until) ||
            inferredUntil ||
            null,
          dates: converted.dates,
          weekdays: converted.weekdays,
          dayType: converted.dayType,
          startTime: rule.startTime ?? startTime,
          endTime: rule.endTime ?? endTime,
          title: rule.title ?? title,
          subject: rule.subject ?? subject,
          type: isPlanType(rule.type) ? rule.type : type,
          memo: typeof rule.memo === "string" ? rule.memo : "",
          isOverride: Boolean(rule.isOverride),
        };
      });

  const legacyRuleInputs: Array<Partial<LegacyRecurrenceRule>> =
    mappedLegacyRules.filter(
      (
        rule,
      ): rule is Exclude<(typeof mappedLegacyRules)[number], null> => rule !== null,
    );

  const recurrenceRules = normalizeRecurrenceRules(
    legacyRuleInputs,
    {
      date: suggestion.parsedPlan.date ?? fallbackDate,
      startTime,
      endTime,
      repeatUntil: inferredUntil,
      title,
      subject,
      type,
      memo: "",
    },
  );

  const repeatUntil = summarizeLegacyRepeatUntilFromRecurrenceRules(
    recurrenceRules,
    inferredUntil ?? null,
  );
  const representativeDate =
    recurrenceRules.length > 0
      ? getFirstRecurrenceOccurrenceDate(
          recurrenceRules,
          input.selectedDate,
          suggestion.parsedPlan.date ?? fallbackDate,
        )
      : suggestion.parsedPlan.date ?? fallbackDate;

  if (inferredUntil && !parsedRules.some((rule) => isIsoDate(rule.until))) {
    assumptions.push("pipeline recurrence に until が無かったため、入力文から repeatUntil を補完しました。");
  }

  return {
    recurrenceRules,
    repeatUntil,
    representativeDate,
    assumptions,
  };
}

function isPlanType(value: unknown): value is PlanType {
  return (
    value === "study" ||
    value === "mock-exam" ||
    value === "school-event" ||
    value === "cram-school" ||
    value === "deadline" ||
    value === "other"
  );
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
  const recurrencePayload = buildLegacyRecurrencePayload(
    suggestion,
    input,
    suggestion.parsedPlan.date ?? input.selectedDate,
    type,
    title,
    subject,
  );
  const recurrenceRules = recurrencePayload.recurrenceRules;
  const repeat =
    summarizeLegacyRepeatFromRecurrenceRules(recurrenceRules) ?? "none";
  const repeatUntil = recurrencePayload.repeatUntil;
  const unresolvedFields = mapUnresolvedFields(suggestion.unresolvedFields);
  const parsedPlan: LegacyPlanDraft = {
    userId: input.userId,
    title,
    subject,
    date: recurrencePayload.representativeDate,
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
      ...recurrencePayload.assumptions,
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

function cloneLegacyDraft(draft: LegacyPlanDraft): LegacyPlanDraft {
  return {
    ...draft,
    excludedDates: [...draft.excludedDates],
    recurrenceRules: draft.recurrenceRules.map((rule) => ({
      ...rule,
      dates: [...rule.dates],
      weekdays: [...rule.weekdays],
    })),
  };
}

function inferEditLegacyType(
  suggestion: PipelineSuggestion,
  input: SuggestionInput,
  matchedPlan: Plan | undefined,
): PlanType {
  if (suggestion.parsedPlan.title || suggestion.parsedPlan.subject || suggestion.parsedPlan.contentText) {
    return inferLegacyType(suggestion, input);
  }

  return matchedPlan?.type ?? "study";
}

function adaptPipelineSuggestionToLegacyEditSuggestion(
  suggestion: PipelineSuggestion,
  input: SuggestionInput,
): NaturalLanguageSuggestion {
  const baseline = generateRuleBasedSuggestion(input);
  const matchedPlan = matchPlan(input.text, input.plans);
  const type = inferEditLegacyType(suggestion, input, matchedPlan);
  const subject =
    suggestion.parsedPlan.subject ||
    inferLegacySubject(suggestion, input) ||
    baseline.parsedPlan.subject;
  const title =
    suggestion.parsedPlan.title ||
    (suggestion.parsedPlan.contentText
      ? inferLegacyTitle(suggestion, type, subject)
      : "") ||
    baseline.parsedPlan.title;
  const unresolvedFields = mapUnresolvedFields(suggestion.unresolvedFields);
  const parsedPlan = cloneLegacyDraft(baseline.parsedPlan);
  const hasPipelineRecurrence =
    (suggestion.parsedPlan.recurrenceRules?.length ?? 0) > 0;
  const recurrencePayload = hasPipelineRecurrence
    ? buildLegacyRecurrencePayload(
        suggestion,
        input,
        parsedPlan.date,
        type,
        title,
        subject,
      )
    : null;

  parsedPlan.title = title;
  parsedPlan.subject = subject;
  parsedPlan.type = type;
  parsedPlan.date =
    recurrencePayload?.representativeDate ??
    suggestion.parsedPlan.date ??
    parsedPlan.date;
  parsedPlan.startTime = suggestion.parsedPlan.startTime ?? parsedPlan.startTime;
  parsedPlan.endTime = suggestion.parsedPlan.endTime ?? parsedPlan.endTime;
  if (recurrencePayload) {
    parsedPlan.recurrenceRules = recurrencePayload.recurrenceRules;
    parsedPlan.repeat =
      (summarizeLegacyRepeatFromRecurrenceRules(
        recurrencePayload.recurrenceRules,
      ) ?? parsedPlan.repeat) as MonthEventRepeat;
    parsedPlan.repeatUntil = recurrencePayload.repeatUntil;
  }

  return {
    ...baseline,
    rawText: suggestion.rawText,
    confidence: inferConfidence(suggestion),
    reason: "新しいルールベース pipeline から構造化した編集案です。",
    status:
      unresolvedFields.length > 0 || !baseline.matchedPlanId
        ? "needs_review"
        : baseline.status,
    parsedPlan,
    assumptions: [
      ...baseline.assumptions,
      ...suggestion.assumptions,
      ...(recurrencePayload?.assumptions ?? []),
      "new pipeline adapter を経由して既存 planner 形式へ変換しました。",
    ],
    unresolvedFields,
  };
}

export function runRulesPipelineEditThroughAdapter(
  input: SuggestionInput,
  options: PipelineOptions = {},
): NaturalLanguageSuggestion[] {
  const result = runNaturalLanguagePipeline(input.text, {
    referenceDate: input.selectedDate,
    ...options,
  });

  if (result.suggestions.length !== 1) {
    return [];
  }

  return [adaptPipelineSuggestionToLegacyEditSuggestion(result.suggestions[0], input)];
}
