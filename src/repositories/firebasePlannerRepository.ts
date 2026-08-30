import type { Firestore } from 'firebase/firestore';
import {
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDocs,
  query,
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
import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
import type { PlannerRepository } from './repositoryContracts';
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

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]),
    ) as T;
  }

  return value;
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

async function upsertStudyMaterialDocument(
  firestoreDb: Firestore,
  item: StudyMaterial,
): Promise<StudyMaterial> {
  const sanitizedItem = stripUndefinedDeep(item);
  const firestorePayload =
    item.paceEnabled === true
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

  await setDoc(doc(firestoreDb, 'study_materials', item.id), firestorePayload, {
    merge: true,
  });

  return sanitizedItem;
}

async function upsertActualDocument(
  firestoreDb: Firestore,
  actual: Actual,
): Promise<Actual> {
  if (!actual.planId) {
    return await upsertDocument(firestoreDb, 'actuals', actual);
  }

  const matchingActuals = await listActualsByPlanOccurrence(firestoreDb, actual);
  const nextActual = stripUndefinedDeep(
    resolveActualForUpsert(matchingActuals, actual),
  );
  const batch = writeBatch(firestoreDb);

  batch.set(doc(firestoreDb, 'actuals', nextActual.id), nextActual, {
    merge: true,
  });
  matchingActuals
    .filter((matchingActual) => matchingActual.id !== nextActual.id)
    .forEach((duplicateActual) => {
      batch.delete(doc(firestoreDb, 'actuals', duplicateActual.id));
    });

  await batch.commit();
  return nextActual;
}


function assertMutationOwner(userId: string, mutation: RecurringPlanMutation): void {
  const records = [
    ...mutation.planUpserts,
    ...mutation.planDeletes,
    ...mutation.actualUpserts,
    ...mutation.actualDeletes,
  ];

  if (records.some((record) => record.userId !== userId)) {
    throw new Error('Recurring plan mutation contains records owned by another user.');
  }
}

export function createFirebasePlannerRepository(
  firestoreDb: Firestore,
): PlannerRepository {
  return {
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
      try {
        return dedupeLinkedActualRecords(
          (await listByUserId<Actual>(firestoreDb, 'actuals', userId)).map(
            normalizeActualRecord,
          ),
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('記録を取得できませんでした。', error as { message?: string | null }),
        );
      }
    },
    async getDayNotes(userId) {
      try {
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
        assertMutationOwner(userId, mutation);
        const reboundIds = new Set(
          mutation.actualUpserts.map((actual) => actual.id),
        );
        const linkedActuals = (
          await Promise.all(
            mutation.planDeletes.map((plan) =>
              listActualsByPlanId(firestoreDb, userId, plan.id),
            ),
          )
        ).flat();
        const actualDeletesById = new Map(
          [...mutation.actualDeletes, ...linkedActuals]
            .filter((actual) => !reboundIds.has(actual.id))
            .map((actual) => [actual.id, actual]),
        );
        const operationCount =
          mutation.planUpserts.length +
          mutation.planDeletes.length +
          mutation.actualUpserts.length +
          actualDeletesById.size;

        if (operationCount > 500) {
          throw new Error('Recurring plan mutation exceeds the Firestore batch limit.');
        }
        if (operationCount === 0) {
          return;
        }

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
        actualDeletesById.forEach((actual) => {
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
    async upsertMonthEvent(monthEvent) {
      try {
        return await upsertDocument(firestoreDb, 'month_events', monthEvent);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '主要予定を保存できませんでした。',
            error as { message?: string | null },
          ),
        );
      }
    },
    async deleteMonthEvent(_userId, monthEventId) {
      try {
        await deleteDoc(doc(firestoreDb, 'month_events', monthEventId));
      } catch (error) {
        throw new Error(
          normalizeErrorMessage(
            '主要予定を削除できませんでした。',
            error as { message?: string | null },
          ),
        );
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
}
