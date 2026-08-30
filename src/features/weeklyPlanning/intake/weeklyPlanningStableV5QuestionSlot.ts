const STABLE_V5_QUESTION_SLOT_PREFIX = 'stable_v5:' as const;

export function decodeWeeklyPlanningStableV5QuestionSlot(
  targetSlot: string | null | undefined,
): string | null {
  if (!targetSlot?.startsWith(STABLE_V5_QUESTION_SLOT_PREFIX)) return null;
  const questionCode = targetSlot.slice(STABLE_V5_QUESTION_SLOT_PREFIX.length).trim();
  return questionCode || null;
}

export function isWeeklyPlanningStableV5QuestionSlot(
  targetSlot: string | null | undefined,
): boolean {
  return decodeWeeklyPlanningStableV5QuestionSlot(targetSlot) !== null;
}
