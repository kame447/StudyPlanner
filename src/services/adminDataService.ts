import type { Firestore } from 'firebase/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import {
  buildAdminDashboardStats,
  buildMaterialSummaries,
  calculateWeekPlannedMinutes,
  getRecentDayNotes,
  getTodayActuals,
  getTodayPlans,
  isIncompleteTodo,
  summarizeLast7Days,
} from '../lib/adminAnalytics';
import { todayIsoDate } from '../lib/date';
import { getFirestoreDb } from '../lib/firebaseClient';
import {
  dedupeLinkedActualRecords,
  normalizeActualRecord,
  normalizePlanRecord,
  normalizeTodoRecord,
} from '../repositories/repositoryUtils';
import type {
  Actual,
  AdminProfile,
  AdminUserDetailData,
  AdminUserSummary,
  DayNote,
  Plan,
  StudyMaterial,
  TodoTask,
} from '../types/domain';

type AdminCollectionName =
  | 'plans'
  | 'actuals'
  | 'todos'
  | 'day_notes'
  | 'study_subjects'
  | 'study_materials';

function getRequiredFirestoreDb(): Firestore {
  const firestoreDb = getFirestoreDb();

  if (!firestoreDb) {
    throw new Error('Firestore が有効化されていません。');
  }

  return firestoreDb;
}

function mapDocument<T>(snapshot: { id: string; data: () => unknown }): T {
  return {
    ...(snapshot.data() as Record<string, unknown>),
    id: snapshot.id,
  } as T;
}

function normalizeProfile(snapshot: { id: string; data: () => unknown }): AdminProfile {
  const data = snapshot.data() as Partial<AdminProfile>;
  const email = data.email?.trim() ?? '';

  return {
    id: data.id?.trim() || snapshot.id,
    email,
    username: data.username?.trim() || email || snapshot.id,
    avatar: data.avatar ?? '',
    createdAt: data.createdAt ?? '',
  };
}

async function listCollection<T>(
  firestoreDb: Firestore,
  collectionName: AdminCollectionName | 'profiles',
): Promise<T[]> {
  const snapshot = await getDocs(collection(firestoreDb, collectionName));
  return snapshot.docs.map((document) => mapDocument<T>(document));
}

async function listByUserId<T>(
  firestoreDb: Firestore,
  collectionName: AdminCollectionName,
  userId: string,
): Promise<T[]> {
  const snapshot = await getDocs(
    query(collection(firestoreDb, collectionName), where('userId', '==', userId)),
  );

  return snapshot.docs.map((document) => mapDocument<T>(document));
}

function groupByUserId<T extends { userId: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  items.forEach((item) => {
    const records = grouped.get(item.userId) ?? [];
    records.push(item);
    grouped.set(item.userId, records);
  });

  return grouped;
}

export async function getAdminUserSummaries(): Promise<AdminUserSummary[]> {
  const firestoreDb = getRequiredFirestoreDb();
  const [profileSnapshots, rawPlans, rawActuals, rawTodos, dayNotes] =
    await Promise.all([
      getDocs(collection(firestoreDb, 'profiles')),
      listCollection<Plan>(firestoreDb, 'plans'),
      listCollection<Actual>(firestoreDb, 'actuals'),
      listCollection<TodoTask>(firestoreDb, 'todos'),
      listCollection<DayNote>(firestoreDb, 'day_notes'),
    ]);
  const profiles = profileSnapshots.docs.map(normalizeProfile);
  const plans = rawPlans.map(normalizePlanRecord);
  const actuals = dedupeLinkedActualRecords(rawActuals.map(normalizeActualRecord));
  const todos = rawTodos.map(normalizeTodoRecord);
  const plansByUserId = groupByUserId(plans);
  const actualsByUserId = groupByUserId(actuals);
  const todosByUserId = groupByUserId(todos);
  const dayNotesByUserId = groupByUserId(dayNotes);

  return profiles
    .map((profile) => ({
      profile,
      stats: buildAdminDashboardStats({
        plans: plansByUserId.get(profile.id) ?? [],
        actuals: actualsByUserId.get(profile.id) ?? [],
        todos: todosByUserId.get(profile.id) ?? [],
        dayNotes: dayNotesByUserId.get(profile.id) ?? [],
        profileCreatedAt: profile.createdAt,
      }),
    }))
    .sort((left, right) =>
      left.profile.username.localeCompare(right.profile.username, 'ja'),
    );
}

export async function getAdminUserDetail(
  userId: string,
): Promise<AdminUserDetailData | null> {
  const firestoreDb = getRequiredFirestoreDb();
  const profileSnapshot = await getDoc(doc(firestoreDb, 'profiles', userId));

  if (!profileSnapshot.exists()) {
    return null;
  }

  const profile = normalizeProfile(profileSnapshot);
  const [
    rawPlans,
    rawActuals,
    rawTodos,
    dayNotes,
    studyMaterials,
  ] = await Promise.all([
    listByUserId<Plan>(firestoreDb, 'plans', userId),
    listByUserId<Actual>(firestoreDb, 'actuals', userId),
    listByUserId<TodoTask>(firestoreDb, 'todos', userId),
    listByUserId<DayNote>(firestoreDb, 'day_notes', userId),
    listByUserId<StudyMaterial>(firestoreDb, 'study_materials', userId),
  ]);
  const referenceDate = todayIsoDate();
  const plans = rawPlans.map(normalizePlanRecord);
  const actuals = dedupeLinkedActualRecords(rawActuals.map(normalizeActualRecord));
  const todos = rawTodos.map(normalizeTodoRecord);
  const stats = buildAdminDashboardStats({
    plans,
    actuals,
    todos,
    dayNotes,
    referenceDate,
    profileCreatedAt: profile.createdAt,
  });

  return {
    profile,
    stats,
    plans,
    actuals,
    todos,
    dayNotes,
    studyMaterials,
    todayPlans: getTodayPlans(plans, referenceDate),
    todayActuals: getTodayActuals(actuals, referenceDate),
    incompleteTodos: todos
      .filter(isIncompleteTodo)
      .sort((left, right) => {
        const leftDue = left.dueDate ?? '9999-12-31';
        const rightDue = right.dueDate ?? '9999-12-31';
        return leftDue.localeCompare(rightDue) || left.title.localeCompare(right.title);
      }),
    recentDayNotes: getRecentDayNotes(dayNotes),
    last7Days: summarizeLast7Days(plans, actuals, referenceDate),
    materialSummaries: buildMaterialSummaries(plans, actuals, studyMaterials),
    weekPlannedMinutes: calculateWeekPlannedMinutes(plans, referenceDate),
    weekActualMinutes: stats.weekStudyMinutes,
  };
}
