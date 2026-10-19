import { collection, doc, getDocFromServer, getDocsFromServer, query, runTransaction, where, type Firestore } from 'firebase/firestore';
import { isCurrentScheduleEventMigration, scheduleEventToMonthEvent, scheduleEventToPlan, type ScheduleEvent } from '../domain/scheduleEvent';
import { todayIsoDate } from '../lib/date';
import type { Actual, MonthEvent, Plan } from '../types/domain';
import type { ConfirmedStudyHistory } from './confirmedStudyHistory';
import { dedupeLinkedActualRecords, normalizeActualRecord } from './repositoryUtils';
import {
  appendStudyRestDay, assertStudyStreakOwner, readStudyRestState, studyHistoryFingerprint,
  type StudyStreakHistory, type StudyStreakRepository,
} from './studyStreakRepository';

const REST_COLLECTION = 'study_rest_days';
function assertServerConfirmed(metadata: { fromCache?: boolean; hasPendingWrites?: boolean } | undefined) {
  if (metadata?.fromCache !== false || metadata.hasPendingWrites !== false) throw new Error('最新の学習履歴を確認できませんでした。');
}

export function createFirebaseStudyStreakRepository(db: Firestore, receipt?: ConfirmedStudyHistory): StudyStreakRepository {
  type CompleteHistory = Omit<StudyStreakHistory, 'restDays'>;
  let cache: { userId: string; hint: string; day: string; generation: number | undefined; history: CompleteHistory } | null = null;
  let display: { hint: string; history: StudyStreakHistory } | null = null;
  let requestSequence = 0;
  let historyEpoch = 0;
  let failedGeneration: number | undefined | null = null;
  let pendingRead: { userId: string; day: string; generation: number | undefined; hint: string | null;
    sequence: number; promise: Promise<StudyStreakHistory> } | null = null;
  const issued = new WeakMap<StudyStreakHistory, { generation: number | undefined; epoch: number }>();
  const changedHistory = () => new Error('学習記録が変更されました。確認し直してください。');
  function assertGeneration(generation: number | undefined) {
    if (receipt && (receipt.writing || generation !== receipt.generation)) throw changedHistory();
  }
  function remember(history: StudyStreakHistory, generation: number | undefined, sequence: number, epoch: number) {
    issued.set(history, { generation, epoch });
    if (sequence === requestSequence && epoch === historyEpoch) display = { hint: studyHistoryFingerprint(history), history };
    return history;
  }
  async function fetchComplete(userId: string): Promise<CompleteHistory> {
    // Independent reads are parallel. Nothing is accepted before all four
    // server-confirmed boundaries (including the rest document) have succeeded.
    const [marker, actuals, events] = await Promise.all([
      getDocFromServer(doc(db, 'schedule_event_migrations', userId)),
      getDocsFromServer(query(collection(db, 'actuals'), where('userId', '==', userId))),
      getDocsFromServer(query(collection(db, 'schedule_events'), where('userId', '==', userId))),
    ]);
    for (const snapshot of [marker, actuals, events]) assertServerConfirmed(snapshot.metadata);
    if (!marker.exists() || !isCurrentScheduleEventMigration(marker.data())) {
      throw new Error('予定の読み込みが完了してから、もう一度開いてください。');
    }
    const scheduleEvents = events.docs.map(row => ({ ...row.data(), id: row.id } as ScheduleEvent));
    const plans = scheduleEvents.map(scheduleEventToPlan)
      .filter((plan): plan is Plan => plan !== null);
    const monthEvents = scheduleEvents.map(scheduleEventToMonthEvent).filter((event): event is MonthEvent => event !== null);
    const actualRows = dedupeLinkedActualRecords(actuals.docs.map(row => normalizeActualRecord({ ...row.data(), id: row.id } as Actual)));
    if ([...scheduleEvents, ...actualRows].some(row => row.userId !== userId)) throw new Error('学習履歴の利用者が一致しません。');
    return { userId, plans, monthEvents, actuals: actualRows, historyComplete: true };
  }
  return {
    canUseRestDays: true,
    peek(userId, hint) {
      return display?.history.userId === userId && hint && display.hint === studyHistoryFingerprint(hint) ? display.history : null;
    },
    async read(userId, options) {
      assertStudyStreakOwner(userId);
      const day = options?.today ?? todayIsoDate();
      const generation = receipt?.generation;
      assertGeneration(generation);
      const hint = options?.hint ? studyHistoryFingerprint(options.hint) : null;
      // Share only the current unsettled confirmation. A forced refresh, changed
      // input, or intervening rest-day transaction must start its own request.
      if (!options?.refresh && pendingRead?.userId === userId && pendingRead.day === day
        && pendingRead.generation === generation && pendingRead.hint === hint
        && pendingRead.sequence === requestSequence) return pendingRead.promise;
      const sequence = ++requestSequence;
      pendingRead = null;
      const confirmation = (async () => {
        const shared = failedGeneration !== generation && !options?.refresh && options?.hint ? receipt?.read(userId, options.hint, day) : null;
        const reusable = shared ?? (cache?.userId === userId && hint !== null && cache.hint === hint
          && cache.day === day && cache.generation === generation && !options?.refresh ? cache.history : null);
        const epoch = reusable ? historyEpoch : ++historyEpoch;
        if (!reusable) { cache = null; failedGeneration = generation; }
        const [history, rest] = await Promise.all([
          reusable ?? fetchComplete(userId).catch(error => {
            if (sequence === requestSequence) { cache = null; failedGeneration = generation; }
            throw error;
          }),
          getDocFromServer(doc(db, REST_COLLECTION, userId)),
        ]);
        assertGeneration(generation);
        if (epoch !== historyEpoch) throw changedHistory();
        assertServerConfirmed(rest.metadata);
        const state = readStudyRestState(rest.exists() ? rest.data() : null, userId);
        if (sequence === requestSequence) {
          cache = { userId, hint: hint ?? studyHistoryFingerprint(history), day, generation, history };
          failedGeneration = null;
        }
        return remember({ ...history, restDays: state.dates.map(date => ({ date })) }, generation, sequence, epoch);
      })();
      if (!options?.refresh) pendingRead = { userId, day, generation, hint, sequence, promise: confirmation };
      try { return await confirmation; }
      finally { if (pendingRead?.promise === confirmation) pendingRead = null; }
    },
    async useRestDay(history, date, today, options) {
      assertStudyStreakOwner(history.userId);
      const sequence = ++requestSequence;
      function current() {
        if (options?.signal?.aborted) throw new Error('学習履歴の確認が中断されました。');
        const proof = issued.get(history);
        if (!proof || proof.epoch !== historyEpoch || failedGeneration === proof.generation) throw changedHistory();
        assertGeneration(proof.generation);
      }
      current();
      const reference = doc(db, REST_COLLECTION, history.userId);
      const state = await runTransaction(db, async transaction => {
        current();
        const snapshot = await transaction.get(reference);
        current();
        const previous = readStudyRestState(snapshot.exists() ? snapshot.data() : null, history.userId);
        const next = appendStudyRestDay(history, previous, date, today);
        if (next !== previous) transaction.set(reference, next);
        return next;
      });
      current();
      // This document serializes devices. Concurrent remote Actual edits are
      // reconciled by the next complete snapshot, not an N-document transaction.
      return remember({ ...history, restDays: state.dates.map(day => ({ date: day })) }, issued.get(history)!.generation, sequence, issued.get(history)!.epoch);
    },
  };
}
