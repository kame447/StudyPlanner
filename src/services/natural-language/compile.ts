import type {
  NormalizedEnumerationIntent,
  NormalizedOverrideIntent,
  NormalizedPlanIntent,
  NormalizedSequencedIntent,
  PlanDraft,
  RecurrenceRule,
  ScheduleIR,
  Suggestion,
  UnresolvedField,
  Weekday,
} from "./shared/types";

function unique<T>(values: T[] | undefined): T[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return [...new Set(values)];
}

function inferSubject(
  contentText?: string,
  contextText?: string
): string | undefined {
  const source = `${contentText ?? ""} ${contextText ?? ""}`;

  if (/英単語|英語|長文|文法|単語/.test(source)) {
    return "英語";
  }

  if (/数学|チャート|数[ⅠⅡIIIＡAＢBＣC]/.test(source)) {
    return "数学";
  }

  return undefined;
}

function inferTitle(
  contentText?: string,
  contextText?: string
): string | undefined {
  if (contentText) {
    if (/英単語/.test(contentText)) {
      return "英単語の復習";
    }

    if (/長文/.test(contentText)) {
      return "長文";
    }

    if (/文法/.test(contentText)) {
      return "文法";
    }

    if (/単語/.test(contentText)) {
      return "単語";
    }

    if (/数学/.test(contentText)) {
      return "数学";
    }

    return contentText;
  }

  if (contextText) {
    if (/英単語/.test(contextText)) {
      return "英単語の復習";
    }

    if (/数学/.test(contextText)) {
      return "数学";
    }

    return contextText;
  }

  return undefined;
}

function toRecurrenceRules(input: {
  dayType?: "weekday" | "weekend";
  weekdays?: Weekday[];
  excludedWeekdays?: Weekday[];
  repeatKind?: "daily" | "weekly" | "monthly" | "unknown";
  startTime?: string;
  endTime?: string;
}): RecurrenceRule[] | undefined {
  if (input.dayType) {
    return [
      {
        kind: "day-type",
        dayType: input.dayType,
        excludedWeekdays: unique(input.excludedWeekdays),
        startTime: input.startTime,
        endTime: input.endTime,
      },
    ];
  }

  if (input.weekdays && input.weekdays.length > 0) {
    return [
      {
        kind: "weekday",
        weekdays: unique(input.weekdays),
        startTime: input.startTime,
        endTime: input.endTime,
      },
    ];
  }

  if (input.repeatKind === "daily") {
    return [
      {
        kind: "daily",
        startTime: input.startTime,
        endTime: input.endTime,
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
    date: base.date,
    dateSpec: base.dateSpec,
    startTime: base.startTime,
    endTime: base.endTime,
    durationMinutes: base.durationMinutes,
    recurrenceRules: toRecurrenceRules({
      dayType: base.dayType,
      weekdays: base.weekdays,
      excludedWeekdays: base.excludedWeekdays,
      repeatKind: base.repeatSpec?.kind,
      startTime: base.startTime,
      endTime: base.endTime,
    }),
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
    date: override.date,
    dateSpec: override.dateSpec,
    startTime: override.startTime,
    endTime: override.endTime,
    durationMinutes: override.durationMinutes,
    recurrenceRules: toRecurrenceRules({
      dayType: override.dayType,
      weekdays: override.weekdays,
      startTime: override.startTime,
      endTime: override.endTime,
    }),
  };
}

function buildSequencedDraft(sequence: NormalizedSequencedIntent): PlanDraft {
  const subject = inferSubject(sequence.contentText);
  const title = inferTitle(sequence.contentText);

  return {
    rawText: sequence.rawText,
    title,
    subject,
    contentText: sequence.contentText,
    date: sequence.date,
    dateSpec: sequence.dateSpec,
    startTime: sequence.startTime,
    endTime: sequence.endTime,
    durationMinutes: sequence.durationMinutes,
  };
}

function buildEnumerationDraft(item: NormalizedEnumerationIntent): PlanDraft {
  const subject = inferSubject(item.contentText, item.baseContentText);
  const title = inferTitle(item.contentText, item.baseContentText);

  return {
    rawText: item.rawText,
    title,
    subject,
    contentText: item.contentText,
    date: item.date,
    dateSpec: item.dateSpec,
    startTime: item.startTime,
    endTime: item.endTime,
    durationMinutes: item.durationMinutes,
    recurrenceRules: toRecurrenceRules({
      dayType: item.dayType,
      weekdays: item.weekdays,
      excludedWeekdays: item.excludedWeekdays,
      repeatKind: item.repeatSpec?.kind,
      startTime: item.startTime,
      endTime: item.endTime,
    }),
  };
}

export function compileToSuggestions(ir: ScheduleIR): Suggestion[] {
  if (!ir.base) {
    return [];
  }

  const base = ir.base;
  const suggestions: Suggestion[] = [];

  if (ir.enumeratedIntents.length === 0) {
    suggestions.push({
      rawText: base.rawText,
      parsedPlan: buildBaseDraft(base),
      assumptions: [...base.assumptions],
      unresolvedFields: [...base.unresolvedFields],
      confidence: 0.9,
    });
  }

  for (const enumeration of ir.enumeratedIntents) {
    suggestions.push({
      rawText: enumeration.rawText,
      parsedPlan: buildEnumerationDraft(enumeration),
      assumptions: [...enumeration.assumptions],
      unresolvedFields: [...enumeration.unresolvedFields],
      confidence: 0.89,
    });
  }

  for (const sequence of ir.sequencedIntents) {
    suggestions.push({
      rawText: sequence.rawText,
      parsedPlan: buildSequencedDraft(sequence),
      assumptions: [...sequence.assumptions],
      unresolvedFields: [...sequence.unresolvedFields],
      confidence: 0.88,
    });
  }

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
