import { addDays, toIsoDate } from './date';
import { isStudyRecordForDisplay, normalizeStudyRecordsForDisplay } from './studyRecords';
import type { Actual, Plan } from '../types/domain';

export interface StudyRestDay {
  date: string;
}

export interface StudyStreakInput {
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  today: string;
  restDays?: readonly StudyRestDay[];
  // An empty/partial/cache-only read must never revoke an existing protected day.
  historyComplete: boolean;
}

export interface StudyStreakModel {
  today: string;
  historyComplete: boolean;
  currentStreak: number | null;
  bestStreak: number | null;
  studyDates: string[];
  protectedDates: string[];
  unprotectedRestDates: string[];
  earnedTicketDates: string[];
  earnedTickets: number | null;
  usedTickets: number | null;
  availableTickets: number | null;
  studyDaysTowardNextTicket: number | null;
}

export function isStudyCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && toIsoDate(date) === value;
}

export function calculateStudyStreaks(dates: readonly string[], today: string) {
  const model = projectStudyDates(dates, [], today);
  return { current: model.currentStreak, best: model.bestStreak };
}

function projectStudyDates(dates: readonly string[], restDays: readonly StudyRestDay[], today: string) {
  const studyDates = [...new Set(dates.filter(date => isStudyCalendarDate(date) && date <= today))].sort();
  const studySet = new Set(studyDates);
  const restDates = [...new Set(restDays.map(day => day.date)
    .filter(date => isStudyCalendarDate(date) && date <= today && !studySet.has(date)))].sort();
  const calendarDates = [...new Set([...studyDates, ...restDates])].sort();
  const protectedDates: string[] = [];
  const unprotectedRestDates: string[] = [];
  const earnedTicketDates: string[] = [];
  let previous: string | null = null;
  let running = 0;
  let bestStreak = 0;
  let availableTickets = 0;

  for (const date of calendarDates) {
    const continues = previous !== null && addDays(previous, 1) === date;
    if (studySet.has(date)) {
      running = continues ? running + 1 : 1;
      bestStreak = Math.max(bestStreak, running);
      if (running % 7 === 0) {
        earnedTicketDates.push(date);
        availableTickets += 1;
      }
      previous = date;
    } else if (continues && running > 0 && availableTickets > 0) {
      // A rest day protects continuity, but is never counted as actual learning
      // or as progress toward the next seven-study-day award.
      protectedDates.push(date);
      availableTickets -= 1;
      previous = date;
    } else {
      unprotectedRestDates.push(date);
    }
  }

  const currentStreak = previous === today || previous === addDays(today, -1) ? running : 0;
  return {
    studyDates, protectedDates, unprotectedRestDates, earnedTicketDates,
    currentStreak, bestStreak, availableTickets,
    earnedTickets: earnedTicketDates.length,
    usedTickets: protectedDates.length,
    studyDaysTowardNextTicket: currentStreak % 7,
  };
}

export function collectStudyDates(input: Pick<StudyStreakInput, 'userId' | 'plans' | 'actuals' | 'today'>): string[] {
  const actuals = input.actuals.filter(actual => actual.userId === input.userId
    && isStudyCalendarDate(actual.occurrenceDate) && actual.occurrenceDate <= input.today);
  const plans = input.plans.filter(plan => plan.userId === input.userId);
  return normalizeStudyRecordsForDisplay({ actuals, plans })
    .filter(record => isStudyRecordForDisplay(record)
      && Number.isFinite(record.durationMinutes) && record.durationMinutes > 0)
    .map(record => record.date);
}

export function buildStudyStreakModel(input: StudyStreakInput): StudyStreakModel {
  if (!isStudyCalendarDate(input.today)) throw new Error('今日の日付を確認できませんでした。');
  const studyDates = collectStudyDates(input);
  const result = projectStudyDates(studyDates, input.restDays ?? [], input.today);
  if (!input.historyComplete) {
    return {
      today: input.today, historyComplete: false, studyDates: result.studyDates,
      currentStreak: null, bestStreak: null, protectedDates: [], unprotectedRestDates: [], earnedTicketDates: [],
      earnedTickets: null, usedTickets: null, availableTickets: null, studyDaysTowardNextTicket: null,
    };
  }
  return { today: input.today, historyComplete: true, ...result };
}

export function studyRestDayBlockReason(input: StudyStreakInput, date: string): string | null {
  if (!input.historyComplete) return '学習履歴を確認してから利用できます。';
  if (!isStudyCalendarDate(date) || date >= input.today) return '日が終わった昨日以前にだけ自動で使用します。';
  if (input.restDays?.some(day => day.date === date)) return 'この日はすでに登録されています。';
  const current = buildStudyStreakModel(input);
  if (current.studyDates.includes(date)) return '学習を記録した日には利用できません。';
  const next = buildStudyStreakModel({ ...input, restDays: [...(input.restDays ?? []), { date }] });
  if (!next.protectedDates.includes(date)) return 'この日をつなげるお休みチケットがありません。';
  if (current.protectedDates.some(existing => !next.protectedDates.includes(existing))) {
    return 'すでに利用したお休みチケットは変更できません。';
  }
  return null;
}

// Only the first unstudied day after a live chain can be protected. Repeating
// this after an acknowledged append covers longer absences without creating
// study days, spending future awards, or displacing legacy manual protections.
export function nextAutomaticStudyRestDate(input: StudyStreakInput): string | null {
  if (!input.historyComplete) return null;
  const model = buildStudyStreakModel(input);
  const occupied = new Set([...model.studyDates, ...(input.restDays ?? []).map(day => day.date)]);
  const candidates = [...new Set([...model.studyDates, ...model.protectedDates]
    .map(date => addDays(date, 1)))].filter(date => date < input.today && !occupied.has(date)).sort();
  return candidates.find(date => studyRestDayBlockReason(input, date) === null) ?? null;
}
