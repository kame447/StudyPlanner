import {
  collection, doc, getDocs, query, runTransaction, where,
  type Firestore,
} from 'firebase/firestore';
import { scheduleEventIdForLegacy, scheduleEventToMonthEvent, type ScheduleEvent } from '../domain/scheduleEvent';
import type { Actual, MonthEvent } from '../types/domain';

// Web SDK transactions cannot enumerate queries. The candidate query is followed
// by transactional rereads, so concurrent edits/deletes cannot be overwritten.
// New clients attach provenance on every save; a snapshot-free legacy client can
// still add a row after enumeration. This is not a cross-version migration lock.
export async function deleteMonthEventPreservingActualSources(
  db: Firestore,
  userId: string,
  monthEventId: string,
  mode: 'canonical' | 'legacy',
): Promise<void> {
  const candidates = await getDocs(query(collection(db, 'actuals'),
    where('userId', '==', userId), where('planId', '==', monthEventId)));
  if (candidates.docs.length > 499) {
    throw new Error('関連する記録が多いため、安全に主要予定を削除できませんでした。予定は削除されていません。サポートにお問い合わせください。');
  }
  const sourceRef = mode === 'canonical'
    ? doc(db, 'schedule_events', scheduleEventIdForLegacy({ kind: 'month-event', id: monthEventId }))
    : doc(db, 'month_events', monthEventId);
  await runTransaction(db, async transaction => {
    const sourceSnapshot = await transaction.get(sourceRef);
    if (!sourceSnapshot.exists()) return;
    const raw = { ...sourceSnapshot.data(), id: sourceSnapshot.id };
    const source = mode === 'canonical'
      ? scheduleEventToMonthEvent(raw as ScheduleEvent) : raw as MonthEvent;
    if (!source || source.userId !== userId || source.id !== monthEventId) {
      throw new Error('主要予定の所有者を確認できませんでした。再読み込みしてください。');
    }
    const currentActuals = await Promise.all(candidates.docs.map(candidate =>
      transaction.get(doc(db, 'actuals', candidate.id))));
    for (const snapshot of currentActuals) {
      if (!snapshot.exists()) continue;
      const actual = snapshot.data() as Actual;
      if (actual.userId !== userId || actual.planId !== monthEventId) continue;
      // Patch only provenance. Never replace a user's newer notes, date or link.
      transaction.set(doc(db, 'actuals', snapshot.id), {
        progressSource: { kind: 'general-event', sourceId: monthEventId },
      }, { merge: true });
    }
    transaction.delete(sourceRef);
  });
}
