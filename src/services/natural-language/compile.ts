import type {
  NormalizedOverrideIntent,
  NormalizedPlanIntent,
  PlanDraft,
  RecurrenceRule,
  ScheduleIR,
  Suggestion,
  UnresolvedField,
} from "./shared/types";

function unique<T>(values: T[] | undefined): T[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return [...new Set(values)];
}

function inferSubject(contentText?: string): string | undefined {
  if (!contentText) {
    return undefined;
  }

  if (/英単語|英語|長文|文法/.test(contentText)) {
    return "英語";
  }

  if (/数学|チャート|数[ⅠⅡIIIＡAＢBＣC]/.test(contentText)) {
    return "数学";
  }

  return undefined;
}

function inferTitle(contentText?: string): string | undefined {
  if (!contentText) {
    return undefined;
  }

  if (/英単語/.test(contentText)) {
    return "英単語の復習";
  }

  if (/長文/.test(contentText)) {
    return "長文";
  }

  if (/文法/.test(contentText)) {
    return "文法";
  }

  if (/数学/.test(contentText)) {
    return "数学";
  }

  return contentText;
}

function baseToRecurrenceRules(
  base: NormalizedPlanIntent
): RecurrenceRule[] | undefined {
  if (base.dayType) {
    return [
      {
        kind: "day-type",
        dayType: base.dayType,
        excludedWeekdays: unique(base.excludedWeekdays),
        startTime: base.startTime,
        endTime: base.endTime,
      },
    ];
  }

  if (base.weekdays && base.weekdays.length > 0) {
    return [
      {
        kind: "weekday",
        weekdays: unique(base.weekdays),
        startTime: base.startTime,
        endTime: base.endTime,
      },
    ];
  }

  if (base.repeatSpec?.kind === "daily") {
    return [
      {
        kind: "daily",
        startTime: base.startTime,
        endTime: base.endTime,
      },
    ];
  }

  return undefined;
}

function overrideToRecurrenceRules(
  override: NormalizedOverrideIntent
): RecurrenceRule[] | undefined {
  if (override.dayType) {
    return [
      {
        kind: "day-type",
        dayType: override.dayType,
        startTime: override.startTime,
        endTime: override.endTime,
      },
    ];
  }

  if (override.weekdays && override.weekdays.length > 0) {
    return [
      {
        kind: "weekday",
        weekdays: unique(override.weekdays),
        startTime: override.startTime,
        endTime: override.endTime,
      },
    ];
  }

  return undefined;
}

function unresolvedFromTime(
  startTime?: string,
  endTime?: string
): UnresolvedField[] {
  const result: UnresolvedField[] = [];

  if (!startTime) {
    result.push("startTime");
  }

  if (!endTime) {
    result.push("endTime");
  }

  return result;
}

function buildBaseDraft(base: NormalizedPlanIntent): PlanDraft {
  const subject = inferSubject(base.contentText);
  const title = inferTitle(base.contentText);

  return {
    rawText: base.rawText,
    title,
    subject,
    contentText: base.contentText,
    startTime: base.startTime,
    endTime: base.endTime,
    durationMinutes: base.durationMinutes,
    recurrenceRules: baseToRecurrenceRules(base),
  };
}

function buildOverrideDraft(
  override: NormalizedOverrideIntent,
  base: NormalizedPlanIntent
): PlanDraft {
  const subject = inferSubject(base.contentText);
  const title = inferTitle(base.contentText);

  return {
    rawText: override.rawText,
    title,
    subject,
    contentText: base.contentText,
    startTime: override.startTime,
    endTime: override.endTime,
    durationMinutes: override.durationMinutes,
    recurrenceRules: overrideToRecurrenceRules(override),
  };
}

export function compileToSuggestions(ir: ScheduleIR): Suggestion[] {
  if (!ir.base) {
    return [];
  }

  const base = ir.base;
  const suggestions: Suggestion[] = [];

  suggestions.push({
    rawText: base.rawText,
    parsedPlan: buildBaseDraft(base),
    assumptions: [...base.assumptions],
    unresolvedFields: [...base.unresolvedFields],
    confidence: 0.9,
  });

  for (const override of ir.overrideIntents) {
    suggestions.push({
      rawText: override.rawText,
      parsedPlan: buildOverrideDraft(override, base),
      assumptions: [...base.assumptions, ...override.assumptions],
      unresolvedFields: unresolvedFromTime(
        override.startTime,
        override.endTime
      ),
      confidence: 0.85,
    });
  }

  return suggestions;
}
