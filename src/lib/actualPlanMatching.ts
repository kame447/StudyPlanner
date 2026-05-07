import { buildPlanOccurrenceKey } from './planRecurrence';
import { minutesBetween, minutesFromTime } from './date';
import type { Actual, Plan } from '../types/domain';

export interface ActualPlanMatchInput {
  id?: string;
  occurrenceDate: string;
  actualStartTime: string;
  actualEndTime: string;
  title?: string;
  subject: string;
}

export interface ActualPlanLinkCandidate {
  plan: Plan;
  occurrenceKey: string;
  score: number;
  isRecorded: boolean;
  reasons: string[];
}

const GENERIC_TITLE_WORDS = new Set([
  '勉強',
  '学習',
  '復習',
  '課題',
  '予習',
  '演習',
  '自習',
  '練習',
  '対策',
  '確認',
  '暗記',
]);

function getInterval(startTime: string, endTime: string): { start: number; end: number } {
  const start = minutesFromTime(startTime);
  return {
    start,
    end: start + minutesBetween(startTime, endTime),
  };
}

function hasTimeOverlap(actual: ActualPlanMatchInput, plan: Plan): boolean {
  const actualInterval = getInterval(actual.actualStartTime, actual.actualEndTime);
  const planInterval = getInterval(plan.startTime, plan.endTime);

  return Math.max(actualInterval.start, planInterval.start) <
    Math.min(actualInterval.end, planInterval.end);
}

function getStartDiffMinutes(actual: ActualPlanMatchInput, plan: Plan): number {
  const actualStart = minutesFromTime(actual.actualStartTime);
  const planStart = minutesFromTime(plan.startTime);
  const rawDiff = Math.abs(actualStart - planStart);

  return Math.min(rawDiff, 24 * 60 - rawDiff);
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function hasPartialSubjectMatch(actualSubject: string, planSubject: string): boolean {
  const actualValue = normalizeText(actualSubject);
  const planValue = normalizeText(planSubject);

  return (
    actualValue.length >= 2 &&
    planValue.length >= 2 &&
    (actualValue.includes(planValue) || planValue.includes(actualValue))
  );
}

function tokenizeTitle(
  value: string | undefined,
  subjects: string[] = [],
): string[] {
  const normalized = normalizeText(value);

  if (!normalized) {
    return [];
  }

  const subjectSet = new Set(
    subjects
      .map((subject) => normalizeText(subject))
      .filter((subject) => subject.length > 0),
  );
  const tokens = normalized
    .split(/[\s、。・,./_-]+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !GENERIC_TITLE_WORDS.has(token) &&
        !subjectSet.has(token),
    );

  return tokens.length > 0 || GENERIC_TITLE_WORDS.has(normalized) || subjectSet.has(normalized)
    ? tokens
    : [normalized];
}

function getCommonTitleTokens(
  actual: ActualPlanMatchInput,
  plan: Plan,
): string[] {
  const subjects = [actual.subject, plan.subject];
  const actualTokens = tokenizeTitle(actual.title, subjects);
  const planTokens = tokenizeTitle(plan.title, subjects);
  const commonTokens = actualTokens.filter((actualToken) =>
    planTokens.some(
      (planToken) =>
        actualToken === planToken ||
        (actualToken.length >= 3 && planToken.includes(actualToken)) ||
        (planToken.length >= 3 && actualToken.includes(planToken)),
    ),
  );

  return [...new Set(commonTokens)];
}

function hasExactTitleMatch(actual: ActualPlanMatchInput, plan: Plan): boolean {
  const actualValue = normalizeText(actual.title);
  const planValue = normalizeText(plan.title);
  const subjects = new Set(
    [actual.subject, plan.subject]
      .map((subject) => normalizeText(subject))
      .filter((subject) => subject.length > 0),
  );

  return (
    actualValue.length > 0 &&
    actualValue === planValue &&
    !GENERIC_TITLE_WORDS.has(actualValue) &&
    !subjects.has(actualValue)
  );
}

function hasMaterialTitleMatch(commonTitleTokens: string[]): boolean {
  return commonTitleTokens.some((token) => token.length >= 3);
}

function getDurationDiffMinutes(actual: ActualPlanMatchInput, plan: Plan): number {
  return Math.abs(
    minutesBetween(actual.actualStartTime, actual.actualEndTime) -
      minutesBetween(plan.startTime, plan.endTime),
  );
}

function isStudyCandidatePlan(plan: Plan): boolean {
  return plan.type === 'study' || plan.type === 'mock-exam' || plan.type === 'cram-school';
}

function scoreLinkCandidate(
  actual: ActualPlanMatchInput,
  plan: Plan,
  actuals: Actual[],
): ActualPlanLinkCandidate | null {
  const reasons: string[] = [];
  let score = isStudyCandidatePlan(plan) ? 8 : 0;
  const isRecorded = actuals.some(
    (item) =>
      item.id !== actual.id &&
      item.planId === plan.id &&
      item.occurrenceDate === actual.occurrenceDate,
  );
  const hasOverlap = hasTimeOverlap(actual, plan);

  if (hasOverlap) {
    score += 40;
    reasons.push('時間が重なっています');
  }

  const startDiff = getStartDiffMinutes(actual, plan);

  if (startDiff <= 15) {
    score += 30;
    reasons.push('開始時刻が近いです');
  } else if (startDiff <= 30) {
    score += 20;
    reasons.push('開始時刻が近めです');
  } else if (startDiff <= 60) {
    score += 10;
  }

  const hasTimeSignal = hasOverlap || startDiff <= 60;
  const actualSubject = normalizeText(actual.subject);
  const planSubject = normalizeText(plan.subject);
  const hasExactSubjectMatch = Boolean(
    actualSubject && planSubject && actualSubject === planSubject,
  );

  if (hasExactSubjectMatch) {
    score += 25;
    reasons.push('科目が一致しています');
  } else if (hasPartialSubjectMatch(actual.subject, plan.subject)) {
    score += 15;
    reasons.push('科目が近いです');
  }

  const commonTitleTokens = getCommonTitleTokens(actual, plan);
  const hasTitleExactMatch = hasExactTitleMatch(actual, plan);
  const hasMaterialMatch = hasMaterialTitleMatch(commonTitleTokens);

  if (hasTitleExactMatch) {
    score += 35;
    reasons.push('タイトルが一致しています');
  } else if (hasMaterialMatch) {
    score += 35;
    reasons.push('教材名が近いです');
  } else if (commonTitleTokens.length > 0) {
    score += 15;
    reasons.push('タイトルの主要語が近いです');
  }

  const durationDiff = getDurationDiffMinutes(actual, plan);
  if (durationDiff <= 15) {
    score += 15;
    reasons.push('所要時間が近いです');
  } else if (durationDiff <= 30) {
    score += 8;
  }

  const hasStrongContentSignal =
    hasTitleExactMatch ||
    hasMaterialMatch ||
    (hasExactSubjectMatch && commonTitleTokens.length >= 1) ||
    commonTitleTokens.length >= 2;

  if (score < 30 || (!hasTimeSignal && !hasStrongContentSignal)) {
    return null;
  }

  return {
    plan,
    occurrenceKey: buildPlanOccurrenceKey(plan.id, plan.date),
    score,
    isRecorded,
    reasons,
  };
}

export function buildActualPlanLinkCandidates(
  actual: ActualPlanMatchInput,
  plans: Plan[],
  actuals: Actual[],
): ActualPlanLinkCandidate[] {
  return plans
    .filter((plan) => plan.date === actual.occurrenceDate)
    .map((plan) => scoreLinkCandidate(actual, plan, actuals))
    .filter((candidate): candidate is ActualPlanLinkCandidate => Boolean(candidate))
    .sort(
      (left, right) =>
        Number(left.isRecorded) - Number(right.isRecorded) ||
        right.score - left.score,
    )
    .slice(0, 3);
}
