import { collection, doc, getDocsFromServer, runTransaction, type Firestore } from 'firebase/firestore';
import { assertAttendanceDraft, assertAttendanceScope, readClassAttendance, type ClassAttendance } from '../domain/classAttendance';
import type { ClassAttendanceRepository } from './classAttendanceRepository';

export function createFirebaseClassAttendanceRepository(db: Firestore): ClassAttendanceRepository {
  function records(userId: string, templateId: string) {
    assertAttendanceScope(userId, templateId);
    return collection(db, 'class_attendance', userId, 'classes', templateId, 'records');
  }
  return {
    async list(userId, templateId) {
      const snapshot = await getDocsFromServer(records(userId, templateId));
      return snapshot.docs.map(row => {
        const record = readClassAttendance(row.data(), userId, templateId);
        if (record.date !== row.id) throw new Error('出欠記録の日付が一致しません。');
        return record;
      }).sort((a, b) => b.date.localeCompare(a.date));
    },
    async save(draft) {
      assertAttendanceDraft(draft);
      const reference = doc(records(draft.userId, draft.templateId), draft.date);
      return runTransaction(db, async transaction => {
        const template = await transaction.get(doc(db, 'schedule_templates', draft.templateId));
        if (!template.exists() || template.data().userId !== draft.userId) {
          throw new Error('この授業は削除されたか、利用できなくなりました。');
        }
        const snapshot = await transaction.get(reference);
        const previous = snapshot.exists() ? readClassAttendance(snapshot.data(), draft.userId, draft.templateId) : null;
        const now = new Date().toISOString();
        const record: ClassAttendance = { ...draft, schemaVersion: 1, createdAt: previous?.createdAt ?? now, updatedAt: now };
        transaction.set(reference, record);
        return record;
      });
    },
  };
}
