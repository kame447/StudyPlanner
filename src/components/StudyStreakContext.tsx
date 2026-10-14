import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStudyStreak, type StudyStreakController } from '../hooks/useStudyStreak';
import { toIsoDate } from '../lib/date';
import { buildStudyStreakModel } from '../lib/studyStreak';
import { studyStreakRepository } from '../repositories';
import type { Actual, Plan } from '../types/domain';
import { useHomeDisplayClock } from './home/HomeDisplayClockContext';

type SharedStudyStreak = {
  userId: string;
  today: string;
  plans: Plan[];
  actuals: Actual[];
  controller: StudyStreakController;
  displayModel: ReturnType<typeof buildStudyStreakModel>;
};
const StudyStreakContext = createContext<SharedStudyStreak | null>(null);

/** One history reader for Home, automatic protection and the detail page. */
export function StudyStreakProvider({ userId, plans, actuals, active = true, blockedError = null, onRetryBlocked, children }: {
  userId: string; plans: Plan[]; actuals: Actual[]; active?: boolean;
  blockedError?: string | null; onRetryBlocked?: () => void; children: ReactNode;
}) {
  const today = toIsoDate(useHomeDisplayClock());
  const controller = useStudyStreak(userId, today, studyStreakRepository, { plans, actuals }, active);
  const incompleteModel = useMemo(() => buildStudyStreakModel({ userId, plans, actuals, today, historyComplete: false }),
    [userId, plans, actuals, today]);
  const visibleController = !active && blockedError ? { ...controller, status: 'error' as const,
    readError: blockedError, retry: onRetryBlocked ?? controller.retry } : controller;
  return <StudyStreakContext.Provider value={{ userId, today, plans, actuals, controller: visibleController,
    displayModel: controller.model ?? incompleteModel }}>{children}</StudyStreakContext.Provider>;
}

export function useSharedStudyStreak() { return useContext(StudyStreakContext); }
