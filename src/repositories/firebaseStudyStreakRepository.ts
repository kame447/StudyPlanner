import { collection, doc, getDocFromServer, getDocsFromServer, query, runTransaction, where, type Firestore } from 'firebase/firestore';
import { isCurrentScheduleEventMigration, scheduleEventToPlan, type ScheduleEvent } from '../domain/scheduleEvent';
import type { Actual, Plan } from '../types/domain';
import { normalizeActualRecord } from './repositoryUtils';
import {
  appendStudyRestDay, assertStudyStreakOwner, readStudyRestState, studyHistoryFingerprint,
  type StudyStreakHistory, type StudyStreakRepository,
} from './studyStreakRepository';

const REST_COLLECTION = 'study_rest_days';

function assertServerConfirmed(metadata: { fromCache: boolean; hasPendingWrites: boolean }) {
  if (metadata.fromCache || metadata.hasPendingWrites) throw new Error('最新の学習履歴を確認できませんでした。');
}

export function createFirebaseStudyStreakRepository(db: Firestore): StudyStreakRepository {
  // One owner-scoped in-memory snapshot. It is not a second persistence authority.
  // Open with unchanged app data reuses this server-confirmed full history; Retry
  // or changed app data reads it again. Nothing is fetched at application startup.
  let cache: { userId: string; hint: string; history: Omit<StudyStreakHistory, 'restDays'> } | null = null;
  return {
    canUseRestDays: true,
    async read(userId, options) {
      assertStudyStreakOwner(userId);
      const hint = options?.hint ? studyHistoryFingerprint(options.hint) : null;
      let history = cache?.userId === userId && hint !== null && cache.hint === hint && !options?.refresh
        ? cache.history : null;
      if (!history) {
        const marker = await getDocFromServer(doc(db, 'schedule_event_migrations', userId));
        assertServerConfirmed(marker.metadata);
        if (!marker.exists() || !isCurrentScheduleEventMigration(marker.data())) {
          throw new Error('予定の読み込みが完了してから、もう一度開いてください。');
        }
        const [actuals, events] = await Promise.all([
          getDocsFromServer(query(collection(db, 'actuals'), where('userId', '==', userId))),
          getDocsFromServer(query(collection(db, 'schedule_events'), where('userId', '==', userId), where('provenance.legacy.kind', '==', 'plan'))),
        ]);
        assertServerConfirmed(actuals.metadata);
        assertServerConfirmed(events.metadata);
        const plans = events.docs.map(row => scheduleEventToPlan({ ...row.data(), id: row.id } as ScheduleEvent))
          .filter((plan): plan is Plan => plan !== null);
        const actualRows = actuals.docs.map(row => normalizeActualRecord({ ...row.data(), id: row.id } as Actual));
        if ([...plans, ...actualRows].some(row => row.userId !== userId)) {
          throw new Error('学習履歴の利用者が一致しません。');
        }
        history = { userId, plans, actuals: actualRows, historyComplete: true };
        cache = { userId, hint: hint ?? studyHistoryFingerprint(history), history };
      }
      // A denied or failed rest-day read is never treated as an empty balance.
      const rest = await getDocFromServer(doc(db, REST_COLLECTION, userId));
      assertServerConfirmed(rest.metadata);
      const state = readStudyRestState(rest.exists() ? rest.data() : null, userId);
      return { ...history, restDays: state.dates.map(date => ({ date })) };
    },
    async useRestDay(history, date, today) {
      assertStudyStreakOwner(history.userId);
      const reference = doc(db, REST_COLLECTION, history.userId);
      const state = await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        const previous = readStudyRestState(snapshot.exists() ? snapshot.data() : null, history.userId);
        const next = appendStudyRestDay(history, previous, date, today);
        if (next !== previous) transaction.set(reference, next);
        return next;
      });
      // The shared rest document serializes competing spends. Actual edits are
      // reconciled from the next complete history; no N-document read transaction.
      return { ...history, restDays: state.dates.map(day => ({ date: day })) };
    },
  };
}
