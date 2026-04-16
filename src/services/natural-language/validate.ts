import type { RecurrenceRule, Suggestion } from "./shared/types";

function isMeaninglessTimeRange(startTime?: string, endTime?: string): boolean {
  if (!startTime || !endTime) {
    return false;
  }

  return startTime === endTime;
}

function hasStructuredRecurrence(suggestion: Suggestion): boolean {
  return (suggestion.parsedPlan.recurrenceRules?.length ?? 0) > 0;
}

function coreKey(suggestion: Suggestion): string {
  const plan = suggestion.parsedPlan;

  return JSON.stringify({
    rawText: suggestion.rawText,
    contentText: plan.contentText ?? "",
    date: plan.date ?? "",
    dateSpec: plan.dateSpec ?? null,
    startTime: plan.startTime ?? "",
    endTime: plan.endTime ?? "",
    durationMinutes: plan.durationMinutes ?? null,
  });
}

function recurrenceSignature(rules?: RecurrenceRule[]): string {
  if (!rules || rules.length === 0) {
    return "__none__";
  }

  return JSON.stringify(
    rules.map((rule) => ({
      kind: rule.kind,
      dayType: rule.dayType ?? null,
      weekdays: [...(rule.weekdays ?? [])].sort(),
      excludedWeekdays: [...(rule.excludedWeekdays ?? [])].sort(),
      startTime: rule.startTime ?? null,
      endTime: rule.endTime ?? null,
    }))
  );
}

function canBeDeduped(a: Suggestion, b: Suggestion): boolean {
  if (coreKey(a) !== coreKey(b)) {
    return false;
  }

  const aRecurrence = recurrenceSignature(a.parsedPlan.recurrenceRules);
  const bRecurrence = recurrenceSignature(b.parsedPlan.recurrenceRules);

  if (aRecurrence === bRecurrence) {
    return true;
  }

  if (aRecurrence === "__none__" || bRecurrence === "__none__") {
    return true;
  }

  return false;
}

function strength(suggestion: Suggestion): number {
  let score = 0;
  const plan = suggestion.parsedPlan;

  if (hasStructuredRecurrence(suggestion)) {
    score += 100;
  }

  if (plan.title) {
    score += 20;
  }

  if (plan.subject) {
    score += 10;
  }

  if (plan.date) {
    score += 8;
  }

  if (plan.startTime) {
    score += 5;
  }

  if (plan.endTime) {
    score += 5;
  }

  score -= suggestion.unresolvedFields.length * 3;
  score += suggestion.confidence ?? 0;

  return score;
}

function isInvalidSuggestion(suggestion: Suggestion): boolean {
  const plan = suggestion.parsedPlan;

  if (isMeaninglessTimeRange(plan.startTime, plan.endTime)) {
    return true;
  }

  return false;
}

function selectStrongerSuggestion(a: Suggestion, b: Suggestion): Suggestion {
  return strength(a) >= strength(b) ? a : b;
}

export function validateAndDedupe(suggestions: Suggestion[]): Suggestion[] {
  const filtered = suggestions.filter(
    (suggestion) => !isInvalidSuggestion(suggestion)
  );
  const result: Suggestion[] = [];

  for (const suggestion of filtered) {
    const existingIndex = result.findIndex((existing) =>
      canBeDeduped(existing, suggestion)
    );

    if (existingIndex === -1) {
      result.push(suggestion);
      continue;
    }

    result[existingIndex] = selectStrongerSuggestion(
      result[existingIndex],
      suggestion
    );
  }

  return result;
}
