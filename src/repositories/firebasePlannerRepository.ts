import { deleteMonthEventPreservingActualSources } from './firebaseActualSourcePreservation';
import type { ConfirmedStudyHistory } from './confirmedStudyHistory';
import type { Firestore } from 'firebase/firestore';
import {
  collection,
  deleteField,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  getDocsFromServer,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type {
  Actual,
  DayNote,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  StudyMaterial,
  StudySubject,
  TimetablePeriod,
  TimetableTerm,
  TodoTask,
} from '../types/domain';
import type { PlannerRepository } from './repositoryContracts';
import {
  assertRecurringMonthEventWrite,
  prepareRecurringPlanWrite,
  stripUndefinedDeep,
} from './plannerWritePreparation';
import {
  dedupeLinkedActualRecords,
  normalizeActualRecord,
  normalizePlanRecord,
  normalizeScheduleTemplateRecord,
  normalizeTimetablePeriodRecord,
  normalizeTimetableTermRecord,
  normalizeTodoRecord,
  resolveActualForUpsert,
} from './repositoryUtils';

type PlannerDoc =
  | Plan
  | Actual
  | DayNote
  | MonthEvent
  | TodoTask
  | StudySubject
  | StudyMaterial
  | ScheduleTemplate
  | TimetableTerm
  | TimetablePeriod;
type FirebaseLikeError = {
  code?: string | null;
  message?: string | null;
  customData?: unknown;
};

function getFirebaseErrorDiagnostics(error: unknown): {
  code: string | null;
  message: string | null;
  customData?: unknown;
} {
  const firebaseError = error as FirebaseLikeError | null;
  return {
    code: firebaseError?.code?.trim() || null,
    message: firebaseError?.message?.trim() || null,
    customData: firebaseError?.customData,
  };
}

function normalizeErrorMessage(
  fallbackMessage: string,
  error: FirebaseLikeError | null,
): string {
  const code = error?.code?.trim();
  const message = error?.message?.trim();

  if (code && message) {
    return `${code}: ${message}`;
  }

  return message || fallbackMessage;
}

type OwnedRecord = { id: string; userId: string };

function assertOwnedRecords(
  userId: string,
  records: readonly OwnedRecord[],
  label: string,
): void {
  if (records.some((record) => record.userId !== userId)) {
    throw new Error(`${label} の所有者が一致しません。`);
  }
}

async function listByUserId<T extends PlannerDoc>(
  firestoreDb: Firestore,
  collectionName: string,
  userId: string,
): Promise<T[]> {
  const snapshot = await getDocs(
    query(collection(firestoreDb, collectionName), where('userId', '==', userId)),
  );

  return snapshot.docs.map((document) => ({
    ...document.data(),
    id: document.id,
  }) as T);
}

async function upsertDocument<T extends PlannerDoc>(
  firestoreDb: Firestore,
  collectionName: string,
  item: T,
): Promise<T> {
  const sanitizedItem = stripUndefinedDeep(item);
  await setDoc(doc(firestoreDb, collectionName, item.id), sanitizedItem, {
    merge: true,
  });
  return sanitizedItem;
}

function prepareMonthEventWrite(event: MonthEvent) {
  return {
    ...stripUndefinedDeep(event),
    // Legacy writes merge. Explicitly returning to automatic color must remove
    // the saved override instead of letting undefined sanitization retain it.
    ...(Object.prototype.hasOwnProperty.call(event, 'color') && event.color === undefined
      ? { color: deleteField() } : {}),
  };
}

async function listActualsByPlanId(
  firestoreDb: Firestore,
  userId: string,
  planId: string,
): Promise<Actual[]> {
  const snapshot = await getDocs(
    query(
      collection(firestoreDb, 'actuals'),
      where('userId', '==', userId),
      where('planId', '==', planId),
    ),
  );

  return snapshot.docs.map((document) => ({
    ...document.data(),
    id: document.id,
  }) as Actual);
}

async function listActualsByPlanOccurrence(
  firestoreDb: Firestore,
  actual: Actual,
): Promise<Actual[]> {
  if (!actual.planId) {
    return [];
  }

  const snapshot = await getDocs(
    query(
      collection(firestoreDb, 'actuals'),
      where('userId', '==', actual.userId),
      where('planId', '==', actual.planId),
      where('occurrenceDate', '==', actual.occurrenceDate),
    ),
  );

  return snapshot.docs.map((document) =>
    normalizeActualRecord({
      ...document.data(),
      id: document.id,
    } as Actual),
  );
}

function studyMaterialFirestorePayload(item: StudyMaterial) {
  const sanitizedItem = stripUndefinedDeep(item);
  return item.paceEnabled === true
    ? sanitizedItem
    : {
        ...sanitizedItem,
        progressUnit: deleteField(),
        progressUnitLabel: deleteField(),
        totalUnits: deleteField(),
        currentUnit: deleteField(),
        targetDate: deleteField(),
        estimatedMinutesPerUnit: deleteField(),
        maxUnitsPerDay: deleteField(),
      };
}

async function upsertStudyMaterialDocument(
  firestoreDb: Firestore,
  item: StudyMaterial,
): Promise<StudyMaterial> {
  const sanitizedItem = stripUndefinedDeep(item);
  await setDoc(
    doc(firestoreDb, 'study_materials', item.id),
    studyMaterialFirestorePayload(item),
    { merge: true },
  );
  return sanitizedItem;
}

async function upsertActualDocument(
  firestoreDb: Firestore,
  actual: Actual,
  materials: readonly StudyMaterial[] = [],
): Promise<Actual> {
  const matchingActuals = actual.planId ? await listActualsByPlanOccurrence(firestoreDb, actual) : [];
  const nextActual = stripUndefinedDeep(resolveActualForUpsert(matchingActuals, actual));
  // An equality document-ID query evaluates a missing resource under the
  // owner-only Rules and is denied. Equal inclusive range bounds keep this an
  // owner-scoped query of exactly one ID, including legacy rows without id data.
  const existing = await getDocs(query(collection(firestoreDb, 'actuals'),
    where('userId', '==', actual.userId),
    where(documentId(), '>=', nextActual.id), where(documentId(), '<=', nextActual.id)));
  return runTransaction(firestoreDb, async transaction => {
    const currentSnapshot = existing.docs.length > 0
      ? await transaction.get(doc(firestoreDb, 'actuals', nextActual.id)) : null;
    const duplicateSnapshots = await Promise.all(matchingActuals.filter(item => item.id !== nextActual.id)
      .map(item => transaction.get(doc(firestoreDb, 'actuals', item.id))));
    const current = currentSnapshot?.exists() ? currentSnapshot.data() as Actual : undefined;
    if (current && current.userId !== actual.userId) throw new Error('記録の所有者が一致しません。');
    if (nextActual.id !== actual.id && (!current || current.planId !== actual.planId
      || current.occurrenceDate !== actual.occurrenceDate)) {
      throw new Error('同じ予定の記録が変更されました。再読み込みしてから保存してください。');
    }
    const savedActual = !nextActual.progressSource && current?.progressSource
      ? { ...nextActual, progressSource: current.progressSource } : nextActual;
    transaction.set(doc(firestoreDb, 'actuals', savedActual.id), savedActual, { merge: true });
    duplicateSnapshots.forEach(snapshot => {
      if (!snapshot.exists()) return;
      const currentDuplicate = snapshot.data() as Actual;
      if (currentDuplicate.userId === savedActual.userId && currentDuplicate.planId === savedActual.planId
        && currentDuplicate.occurrenceDate === savedActual.occurrenceDate) {
        transaction.delete(doc(firestoreDb, 'actuals', snapshot.id));
      }
    });
    materials.forEach(material => transaction.set(
      doc(firestoreDb, 'study_materials', material.id), studyMaterialFirestorePayload(material), { merge: true },
    ));
    return savedActual;
  });
}

export function createFirebasePlannerRepository(
  firestoreDb: Firestore,
  studyHistory?: ConfirmedStudyHistory,
): PlannerRepository {
  const repository: PlannerRepository = {
    async getScheduleSnapshot(userId) {
      const [plans, monthEvents] = await Promise.all([
        repository.getPlans(userId), repository.getMonthEvents(userId),
      ]);
      return { plans, monthEvents };
    },
    async getPlans(userId) {
      try {
        return (await listByUserId<Plan>(firestoreDb, 'plans', userId)).map(
          normalizePlanRecord,
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('予定を取得できませんでした。', error as { message?: string | null }),
        );
      }
    },
    async getActuals(userId) {
      const publish = studyHistory?.beginRead(userId, 'actuals');
      try {
        const snapshot = await getDocs(query(collection(firestoreDb, 'actuals'), where('userId', '==', userId)));
        const actuals = dedupeLinkedActualRecords(snapshot.docs.map(row =>
          normalizeActualRecord({ ...row.data(), id: row.id } as Actual)));
        publish?.(actuals, snapshot.metadata);
        return actuals;
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('記録を取得できませんでした。', error as { message?: string | null }),
        );
      }
    },
    async getDayNotes(userId, options) {
      try {
        if (options?.requireServer) {
          const snapshot = await getDocsFromServer(
            query(collection(firestoreDb, 'day_notes'), where('userId', '==', userId)),
          );
          if (snapshot.metadata?.fromCache !== false || snapshot.metadata.hasPendingWrites !== false) {
            throw new Error('日次メモの保存済みデータを確認できませんでした。オンラインで再読み込みしてください。');
          }
          return snapshot.docs.map(document => ({ ...document.data(), id: document.id }) as DayNote);
        }
        return await listByUserId<DayNote>(firestoreDb, 'day_notes', userId);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('日次メモを取得できませんでした。', error as { message?: string | null }),
        );
      }
    },
    async getMonthEvents(userId) {
      try {
        return await listByUserId<MonthEvent>(firestoreDb, 'month_events', userId);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '主要予定を取得できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async getTodos(userId) {
      try {
        return (await listByUserId<TodoTask>(firestoreDb, 'todos', userId)).map(
          normalizeTodoRecord,
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            'Todoを取得できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async getStudySubjects(userId) {
      try {
        return await listByUserId<StudySubject>(
          firestoreDb,
          'study_subjects',
          userId,
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '教科を取得できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async getStudyMaterials(userId) {
      try {
        return await listByUserId<StudyMaterial>(
          firestoreDb,
          'study_materials',
          userId,
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '教材を取得できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async getScheduleTemplates(userId) {
      try {
        return (
          await listByUserId<ScheduleTemplate>(
            firestoreDb,
            'schedule_templates',
            userId,
          )
        ).map(normalizeScheduleTemplateRecord);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '時間割を取得できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async getTimetableTerms(userId) {
      try {
        return (await listByUserId<TimetableTerm>(
          firestoreDb,
          'timetable_terms',
          userId,
        )).map(normalizeTimetableTermRecord);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '時間割の学期を取得できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async getTimetablePeriods(userId) {
      try {
        return (await listByUserId<TimetablePeriod>(
          firestoreDb,
          'timetable_periods',
          userId,
        )).map(normalizeTimetablePeriodRecord);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '時間割の時限設定を取得できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async applyRecurringPlanMutation(userId, mutation) {
      try {
        assertOwnedRecords(
          userId,
          [
            ...mutation.planUpserts,
            ...mutation.planDeletes,
            ...mutation.actualUpserts,
            ...mutation.actualDeletes,
          ],
          '繰り返し予定更新',
        );
        const [linkedActuals, duplicateOccurrenceActuals] = await Promise.all([
          Promise.all(
            mutation.planDeletes.map((plan) =>
              listActualsByPlanId(firestoreDb, userId, plan.id),
            ),
          ).then((groups) => groups.flat()),
          Promise.all(
            mutation.actualDeletes.map((actual) =>
              listActualsByPlanOccurrence(firestoreDb, actual),
            ),
          ).then((groups) => groups.flat()),
        ]);
        const { actualDeletes, operationCount } = prepareRecurringPlanWrite(mutation, {
          linkedActuals,
          duplicateOccurrenceActuals,
        });
        if (operationCount === 0) return;

        const batch = writeBatch(firestoreDb);
        mutation.planUpserts.forEach((plan) => {
          batch.set(
            doc(firestoreDb, 'plans', plan.id),
            stripUndefinedDeep(plan),
            { merge: true },
          );
        });
        mutation.planDeletes.forEach((plan) => {
          batch.delete(doc(firestoreDb, 'plans', plan.id));
        });
        mutation.actualUpserts.forEach((actual) => {
          batch.set(
            doc(firestoreDb, 'actuals', actual.id),
            stripUndefinedDeep(actual),
            { merge: true },
          );
        });
        actualDeletes.forEach((actual) => {
          batch.delete(doc(firestoreDb, 'actuals', actual.id));
        });
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '繰り返し予定を保存できませんでした。',
            error as FirebaseLikeError,
          ),
        );
      }
    },
    async deletePlanWithDependents(mutation) {
      try {
        assertOwnedRecords(
          mutation.userId,
          mutation.todo ? [mutation.plan, mutation.todo] : [mutation.plan],
          '予定削除',
        );
        const actuals = await listActualsByPlanId(
          firestoreDb,
          mutation.userId,
          mutation.plan.id,
        );
        const batch = writeBatch(firestoreDb);
        batch.delete(doc(firestoreDb, 'plans', mutation.plan.id));
        actuals.forEach((actual) => {
          batch.delete(doc(firestoreDb, 'actuals', actual.id));
        });
        if (mutation.todo) {
          batch.set(
            doc(firestoreDb, 'todos', mutation.todo.id),
            stripUndefinedDeep(mutation.todo),
            { merge: true },
          );
        }
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('予定を削除できませんでした。', error as FirebaseLikeError),
        );
      }
    },
    async restorePlanWithDependents(mutation) {
      try {
        const userId = mutation.plan.userId;
        assertOwnedRecords(
          userId,
          [mutation.plan, ...mutation.actuals, ...(mutation.todo ? [mutation.todo] : [])],
          '予定復元',
        );
        const batch = writeBatch(firestoreDb);
        batch.set(
          doc(firestoreDb, 'plans', mutation.plan.id),
          stripUndefinedDeep(mutation.plan),
          { merge: true },
        );
        mutation.actuals.forEach((actual) => {
          batch.set(
            doc(firestoreDb, 'actuals', actual.id),
            stripUndefinedDeep(actual),
            { merge: true },
          );
        });
        if (mutation.todo) {
          batch.set(
            doc(firestoreDb, 'todos', mutation.todo.id),
            stripUndefinedDeep(mutation.todo),
            { merge: true },
          );
        }
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('予定を復元できませんでした。', error as FirebaseLikeError),
        );
      }
    },
    async scheduleTodoPlan(mutation) {
      try {
        assertOwnedRecords(mutation.plan.userId, [mutation.plan, mutation.todo], 'Todo予定化');
        const batch = writeBatch(firestoreDb);
        batch.set(
          doc(firestoreDb, 'plans', mutation.plan.id),
          stripUndefinedDeep(mutation.plan),
          { merge: true },
        );
        batch.set(
          doc(firestoreDb, 'todos', mutation.todo.id),
          stripUndefinedDeep(mutation.todo),
          { merge: true },
        );
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('Todoを予定化できませんでした。', error as FirebaseLikeError),
        );
      }
    },
    async upsertActualWithMaterialProgress(mutation) {
      try {
        assertOwnedRecords(mutation.actual.userId, [mutation.actual, ...mutation.materials], '記録保存');
        return await upsertActualDocument(firestoreDb, mutation.actual, mutation.materials);
      } catch (error) {
        throw new Error(normalizeErrorMessage('記録を保存できませんでした。', error as FirebaseLikeError));
      }
    },
    async upsertStudySubjectWithMaterials(mutation) {
      try {
        const userId = mutation.subject.userId;
        assertOwnedRecords(
          userId,
          [mutation.subject, ...mutation.materials],
          '教科保存',
        );
        const batch = writeBatch(firestoreDb);
        batch.set(
          doc(firestoreDb, 'study_subjects', mutation.subject.id),
          stripUndefinedDeep(mutation.subject),
          { merge: true },
        );
        mutation.materials.forEach((material) => {
          batch.set(
            doc(firestoreDb, 'study_materials', material.id),
            studyMaterialFirestorePayload(material),
            { merge: true },
          );
        });
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('教科を保存できませんでした。', error as FirebaseLikeError),
        );
      }
    },
    async applyTimetableMutation(mutation) {
      try {
        assertOwnedRecords(
          mutation.userId,
          [
            ...mutation.termUpserts,
            ...mutation.termDeletes,
            ...mutation.templateUpserts,
            ...mutation.templateDeletes,
            ...mutation.periodUpserts,
            ...mutation.periodDeletes,
          ],
          '時間割更新',
        );
        const batch = writeBatch(firestoreDb);
        mutation.termUpserts.forEach((term) => {
          batch.set(
            doc(firestoreDb, 'timetable_terms', term.id),
            stripUndefinedDeep(term),
            { merge: true },
          );
        });
        mutation.templateUpserts.forEach((template) => {
          batch.set(
            doc(firestoreDb, 'schedule_templates', template.id),
            stripUndefinedDeep(template),
            { merge: true },
          );
        });
        mutation.periodUpserts.forEach((period) => {
          batch.set(
            doc(firestoreDb, 'timetable_periods', period.id),
            stripUndefinedDeep(period),
            { merge: true },
          );
        });
        mutation.termDeletes.forEach((term) => {
          batch.delete(doc(firestoreDb, 'timetable_terms', term.id));
        });
        mutation.templateDeletes.forEach((template) => {
          batch.delete(doc(firestoreDb, 'schedule_templates', template.id));
        });
        mutation.periodDeletes.forEach((period) => {
          batch.delete(doc(firestoreDb, 'timetable_periods', period.id));
        });
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('時間割を更新できませんでした。', error as FirebaseLikeError),
        );
      }
    },
    async upsertPlan(plan) {
      try {
        return await upsertDocument(firestoreDb, 'plans', plan);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('予定を保存できませんでした。', error as { message?: string | null }),
        );
      }
    },
    async deletePlan(userId, planId) {
      try {
        console.info('[PlannerRepository] deletePlan query', {
          collection: 'actuals',
          userId,
          planId,
        });
        const batch = writeBatch(firestoreDb);
        const actuals = await listActualsByPlanId(firestoreDb, userId, planId);
        const actualIds = actuals.map((actual) => actual.id);

        console.info('[PlannerRepository] deletePlan targets', {
          userId,
          planId,
          operations: [
            ...actualIds.map((actualId) => ({
              collection: 'actuals',
              operation: 'delete',
              id: actualId,
            })),
            {
              collection: 'plans',
              operation: 'delete',
              id: planId,
            },
          ],
        });

        batch.delete(doc(firestoreDb, 'plans', planId));
        actuals.forEach((actual) => {
          batch.delete(doc(firestoreDb, 'actuals', actual.id));
        });

        await batch.commit();
      } catch (error) {
        console.error('[PlannerRepository] deletePlan failed', {
          userId,
          planId,
          error: getFirebaseErrorDiagnostics(error),
        });
        throw new Error(
          normalizeErrorMessage('予定を削除できませんでした。', error as FirebaseLikeError),
        );
      }
    },
    async upsertActual(actual) {
      try {
        return await upsertActualDocument(firestoreDb, actual);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('記録を保存できませんでした。', error as { message?: string | null }),
        );
      }
    },
    async deleteActual(_userId, actualId) {
      try {
        await deleteDoc(doc(firestoreDb, 'actuals', actualId));
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('記録を削除できませんでした。', error as { message?: string | null }),
        );
      }
    },
    async upsertDayNote(dayNote) {
      try {
        return await upsertDocument(firestoreDb, 'day_notes', dayNote);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('日次メモを保存できませんでした。', error as { message?: string | null }),
        );
      }
    },
    async applyRecurringMonthEventMutation(userId, monthEvents) {
      try {
        assertRecurringMonthEventWrite(userId, monthEvents);
        const batch = writeBatch(firestoreDb);
        monthEvents.forEach((event) => {
          batch.set(doc(firestoreDb, 'month_events', event.id), prepareMonthEventWrite(event), { merge: true });
        });
        await batch.commit();
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('繰り返し予定を保存できませんでした。', error as FirebaseLikeError),
        );
      }
    },
    async upsertMonthEvent(monthEvent) {
      try {
        await setDoc(doc(firestoreDb, 'month_events', monthEvent.id), prepareMonthEventWrite(monthEvent), { merge: true });
        return stripUndefinedDeep(monthEvent);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '主要予定を保存できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async deleteMonthEvent(userId, monthEventId) {
      try {
        await deleteMonthEventPreservingActualSources(firestoreDb, userId, monthEventId, 'legacy');
      } catch (error) {
        throw new Error(normalizeErrorMessage('主要予定を削除できませんでした。', error as FirebaseLikeError));
      }
    },
    async upsertTodo(todo) {
      try {
        return await upsertDocument(firestoreDb, 'todos', todo);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            'Todoを保存できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async deleteTodo(_userId, todoId) {
      try {
        await deleteDoc(doc(firestoreDb, 'todos', todoId));
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            'Todoを削除できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async upsertStudySubject(item) {
      try {
        return await upsertDocument(firestoreDb, 'study_subjects', item);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '教科を保存できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async deleteStudySubject(_userId, subjectId) {
      try {
        await deleteDoc(doc(firestoreDb, 'study_subjects', subjectId));
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '教科を削除できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async upsertStudyMaterial(item) {
      try {
        return await upsertStudyMaterialDocument(firestoreDb, item);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '教材を保存できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async updateStudyMaterialProgress(_userId, materialId, nextCurrentUnit) {
      const updatedAt = new Date().toISOString();

      try {
        await setDoc(
          doc(firestoreDb, 'study_materials', materialId),
          {
            currentUnit: Math.max(0, nextCurrentUnit),
            updatedAt,
          },
          { merge: true },
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '教材の進捗を保存できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async deleteStudyMaterial(_userId, materialId) {
      try {
        await deleteDoc(doc(firestoreDb, 'study_materials', materialId));
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '教材を削除できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async upsertScheduleTemplate(item) {
      try {
        return await upsertDocument(firestoreDb, 'schedule_templates', item);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '時間割を保存できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async deleteScheduleTemplate(_userId, templateId) {
      try {
        await deleteDoc(doc(firestoreDb, 'schedule_templates', templateId));
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '時間割を削除できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async upsertTimetableTerm(item) {
      try {
        return await upsertDocument(firestoreDb, 'timetable_terms', item);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '時間割の学期を保存できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async deleteTimetableTerm(_userId, termId) {
      try {
        await deleteDoc(doc(firestoreDb, 'timetable_terms', termId));
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '時間割の学期を削除できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async upsertTimetablePeriod(item) {
      try {
        return await upsertDocument(firestoreDb, 'timetable_periods', item);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '時間割の時限設定を保存できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async deleteTimetablePeriod(_userId, periodId) {
      try {
        await deleteDoc(doc(firestoreDb, 'timetable_periods', periodId));
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '時間割の時限設定を削除できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
  };
  return repository;
}
