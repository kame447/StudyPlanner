import { deleteDoc, doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { getFirestoreDb } from '../../../lib/firebaseClient';
import type { WeeklyPlanningWeekStartsOn } from './weeklyPlanningWeek';
import {
  createConfirmedWeekStartFact,
  createEmptyWeeklyPlanningPersonalizationProfile,
  sanitizeWeeklyPlanningPersonalizationProfile,
  type WeeklyPlanningPersonalizationProfile,
} from './weeklyPlanningPersonalizationTypes';

const COLLECTION = 'weekly_planning_personalization_profiles';
const LOCAL_KEY_PREFIX = 'studyplanner-weekly-personalization-v1:';

export interface WeeklyPlanningPersonalizationRepository {
  getProfile(userId: string): Promise<WeeklyPlanningPersonalizationProfile | null>;
  setWeekStartsOn(
    userId: string,
    weekStartsOn: WeeklyPlanningWeekStartsOn,
  ): Promise<WeeklyPlanningPersonalizationProfile>;
  resetProfile(userId: string): Promise<void>;
}

function requireUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized || normalized === 'anonymous') {
    throw new Error('個別最適化プロフィールの利用者を確認できませんでした。');
  }
  return normalized;
}

function localKey(userId: string): string {
  return `${LOCAL_KEY_PREFIX}${encodeURIComponent(requireUserId(userId))}`;
}

export function createLocalWeeklyPlanningPersonalizationRepository(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): WeeklyPlanningPersonalizationRepository {
  return {
    async getProfile(userId) {
      const raw = storage.getItem(localKey(userId));
      if (!raw) return null;
      try {
        return sanitizeWeeklyPlanningPersonalizationProfile(JSON.parse(raw));
      } catch {
        return null;
      }
    },

    async setWeekStartsOn(userId, weekStartsOn) {
      const current = await this.getProfile(userId)
        ?? createEmptyWeeklyPlanningPersonalizationProfile();
      const now = new Date().toISOString();
      const next: WeeklyPlanningPersonalizationProfile = {
        ...current,
        weekStartsOn: createConfirmedWeekStartFact(weekStartsOn, now),
        updatedAt: now,
      };
      storage.setItem(localKey(userId), JSON.stringify(next));
      return next;
    },

    async resetProfile(userId) {
      storage.removeItem(localKey(userId));
    },
  };
}

export function createFirestoreWeeklyPlanningPersonalizationRepository(
  firestore: Firestore,
): WeeklyPlanningPersonalizationRepository {
  return {
    async getProfile(userId) {
      const snapshot = await getDoc(doc(firestore, COLLECTION, requireUserId(userId)));
      return snapshot.exists()
        ? sanitizeWeeklyPlanningPersonalizationProfile(snapshot.data())
        : null;
    },

    async setWeekStartsOn(userId, weekStartsOn) {
      const normalizedUserId = requireUserId(userId);
      const current = await this.getProfile(normalizedUserId)
        ?? createEmptyWeeklyPlanningPersonalizationProfile();
      const now = new Date().toISOString();
      const next: WeeklyPlanningPersonalizationProfile = {
        ...current,
        weekStartsOn: createConfirmedWeekStartFact(weekStartsOn, now),
        updatedAt: now,
      };
      await setDoc(doc(firestore, COLLECTION, normalizedUserId), next, { merge: false });
      return next;
    },

    async resetProfile(userId) {
      await deleteDoc(doc(firestore, COLLECTION, requireUserId(userId)));
    },
  };
}

let repository: WeeklyPlanningPersonalizationRepository | null = null;

export function getWeeklyPlanningPersonalizationRepository(): WeeklyPlanningPersonalizationRepository {
  if (repository) return repository;
  const firestore = getFirestoreDb();
  repository = firestore
    ? createFirestoreWeeklyPlanningPersonalizationRepository(firestore)
    : createLocalWeeklyPlanningPersonalizationRepository();
  return repository;
}

export function setWeeklyPlanningPersonalizationRepositoryForTests(
  next: WeeklyPlanningPersonalizationRepository | null,
): void {
  repository = next;
}
