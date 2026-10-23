import { isStudyCalendarDate, studyRestDayBlockReason, type StudyRestDay } from '../lib/studyStreak';
import type { Actual, MonthEvent, Plan } from '../types/domain';
import type { PlannerRepository } from './repositoryContracts';

export interface StudyStreakHistory {
  userId: string;
  plans: Plan[];
  monthEvents: MonthEvent[];
  actuals: Actual[];
  restDays: StudyRestDay[];
  historyComplete: true;
}

export interface StudyHistoryHint { plans: Plan[]; actuals: Actual[]; monthEvents: MonthEvent[] }
export interface StudyRestState {
  schemaVersion: 1;
  userId: string;
  revision: number;
  dates: string[];
}

export interface StudyStreakRepository {
  readonly canUseRestDays: boolean;
  peek?(userId: string, hint?: StudyHistoryHint): StudyStreakHistory | null;
  read(userId: string, options?: { hint?: StudyHistoryHint; refresh?: boolean; today?: string }): Promise<StudyStreakHistory>;
  useRestDay(history: StudyStreakHistory, date: string, today: string, options?: { signal?: AbortSignal }): Promise<StudyStreakHistory>;
}

export function assertStudyStreakOwner(userId: string) {
  if (!userId.trim() || userId.includes('/') || userId === '.' || userId === '..') {
    throw new Error('学習履歴の利用者を確認できませんでした。');
  }
}

export function readStudyRestState(value: unknown, userId: string): StudyRestState {
  assertStudyStreakOwner(userId);
  if (value === null) return { schemaVersion: 1, userId, revision: 0, dates: [] };
  const state = value as Partial<StudyRestState> | undefined;
  if (!state || state.schemaVersion !== 1 || state.userId !== userId
    || !Number.isSafeInteger(state.revision) || Number(state.revision) < 0
    || !Array.isArray(state.dates) || state.dates.some(date => typeof date !== 'string' || !isStudyCalendarDate(date))
    || new Set(state.dates).size !== state.dates.length) {
    throw new Error('お休みチケットの記録を確認できませんでした。');
  }
  return { schemaVersion: 1, userId, revision: state.revision!, dates: [...state.dates].sort() };
}

export function appendStudyRestDay(history: StudyStreakHistory, state: StudyRestState, date: string, today: string): StudyRestState {
  if (history.userId !== state.userId || !history.historyComplete || !Array.isArray(history.monthEvents)
    || history.actuals.some(row => row.userId !== history.userId)
    || history.plans.some(row => row.userId !== history.userId)
    || history.monthEvents.some(row => row.userId !== history.userId)) {
    throw new Error('学習履歴を確認してから利用できます。');
  }
  // Retrying the exact date after an uncertain acknowledgement is idempotent.
  if (state.dates.includes(date)) return state;
  const reason = studyRestDayBlockReason({ ...history, today, restDays: state.dates.map(day => ({ date: day })) }, date);
  if (reason) throw new Error(reason);
  return { ...state, revision: state.revision + 1, dates: [...state.dates, date].sort() };
}

export function studyHistoryFingerprint(hint: StudyHistoryHint): string {
  return JSON.stringify({
    plans: [...hint.plans].sort((a, b) => a.id.localeCompare(b.id)),
    monthEvents: [...hint.monthEvents].sort((a, b) => a.id.localeCompare(b.id)),
    actuals: [...hint.actuals].sort((a, b) => a.id.localeCompare(b.id)),
  });
}

type WithLock = <T>(name: string, work: () => Promise<T>) => Promise<T>;

export function createLocalStudyStreakRepository(
  storage: Storage,
  planner: Pick<PlannerRepository, 'getScheduleSnapshot' | 'getActuals'>,
  withLock: WithLock | null = typeof navigator !== 'undefined' && navigator.locks
    ? async (name, work) => await navigator.locks.request(name, work) : null,
): StudyStreakRepository {
  function key(userId: string) {
    assertStudyStreakOwner(userId);
    return `studyplanner.studyRestDays.v1:${encodeURIComponent(userId)}`;
  }
  function state(userId: string) {
    const raw = storage.getItem(key(userId));
    return readStudyRestState(raw === null ? null : JSON.parse(raw), userId);
  }
  function assertReadableHistoryStorage() {
    // The legacy local adapters deliberately default malformed JSON to empty.
    // That compatibility fallback cannot certify a complete reward history.
    for (const source of ['studyplanner.actuals', 'studyplanner.plans', 'studyplanner.monthEvents',
      'studyplanner.scheduleEvents.v1', 'studyplanner.scheduleEventMigrations.v1']) {
      const raw = storage.getItem(source);
      if (raw !== null && !Array.isArray(JSON.parse(raw))) {
        throw new Error('保存された学習履歴を確認できませんでした。');
      }
    }
  }
  async function read(userId: string): Promise<StudyStreakHistory> {
    assertStudyStreakOwner(userId);
    assertReadableHistoryStorage();
    const [schedule, actuals] = await Promise.all([planner.getScheduleSnapshot(userId), planner.getActuals(userId)]);
    assertReadableHistoryStorage();
    return { userId, ...schedule, actuals, restDays: state(userId).dates.map(date => ({ date })), historyComplete: true };
  }
  return {
    canUseRestDays: withLock !== null,
    read,
    async useRestDay(history, date, today, options) {
      if (!withLock) throw new Error('このブラウザーではお休みチケットを安全に保存できません。');
      return withLock(key(history.userId), async () => {
        if (options?.signal?.aborted) throw new Error('学習履歴の確認が中断されました。');
        const current = await read(history.userId);
        if (options?.signal?.aborted) throw new Error('学習履歴の確認が中断されました。');
        const previous = state(history.userId);
        const next = appendStudyRestDay(current, previous, date, today);
        if (next !== previous) storage.setItem(key(history.userId), JSON.stringify(next));
        return { ...current, restDays: next.dates.map(day => ({ date: day })) };
      });
    },
  };
}

export function createUnavailableStudyStreakRepository(): StudyStreakRepository {
  const unavailable = async (): Promise<never> => { throw new Error('学習履歴の保存先を確認できませんでした。'); };
  return { canUseRestDays: false, read: unavailable, useRestDay: unavailable };
}
