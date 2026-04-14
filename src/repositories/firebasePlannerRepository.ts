import type { Firestore } from 'firebase/firestore';
import {
  collection,
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
} from '../types/domain';
import type { PlannerRepository } from './repositoryContracts';
import { normalizeActualRecord, normalizePlanRecord } from './repositoryUtils';

type PlannerDoc = Plan | Actual | DayNote | MonthEvent;
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

  return snapshot.docs.map((document) => document.data() as T);
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

  return snapshot.docs.map((document) => document.data() as Actual);
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
        return (await listByUserId<Actual>(firestoreDb, 'actuals', userId)).map(
          normalizeActualRecord,
        );
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('実績を取得できませんでした。', error as { message?: string | null }),
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
        return await upsertDocument(firestoreDb, 'actuals', actual);
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('実績を保存できませんでした。', error as { message?: string | null }),
        );
      }
    },
    async deleteActual(_userId, actualId) {
      try {
        await deleteDoc(doc(firestoreDb, 'actuals', actualId));
      } catch (error) {
        throw new Error(
          normalizeErrorMessage('実績を削除できませんでした。', error as { message?: string | null }),
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
  };
}
