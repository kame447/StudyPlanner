import { useEffect, useMemo } from 'react';
import { useStudyStreak } from '../hooks/useStudyStreak';
import { buildStudyStreakModel } from '../lib/studyStreak';
import { toIsoDate } from '../lib/date';
import { studyStreakRepository } from '../repositories';
import type { Actual, Plan } from '../types/domain';
import { useHomeDisplayClock } from './home/HomeDisplayClockContext';
import type { VerifiedStudyStreakSummary } from './HomeTopbar';
import { StudyStreakView } from './StudyStreakView';

export function StudyStreakPage({ userId, plans, actuals, onClose, onSummaryChange }: {
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  onClose: () => void;
  onSummaryChange?: (summary: VerifiedStudyStreakSummary | null) => void;
}) {
  const today = toIsoDate(useHomeDisplayClock());
  const history = useStudyStreak(userId, today, studyStreakRepository, { plans, actuals });
  useEffect(() => {
    const model = history.model;
    if (history.status === 'ready' && model?.historyComplete && model.currentStreak !== null && model.bestStreak !== null) {
      onSummaryChange?.({ userId, today, plans, actuals, currentStreak: model.currentStreak, bestStreak: model.bestStreak });
    } else onSummaryChange?.(null);
  }, [history.status, history.model, userId, today, plans, actuals, onSummaryChange]);
  const incompleteModel = useMemo(() => buildStudyStreakModel({ userId, plans, actuals, today, historyComplete: false }),
    [userId, plans, actuals, today]);
  return <StudyStreakView today={today} model={history.model ?? incompleteModel} onClose={onClose}
    pending={history.status === 'loading'} error={history.readError} onRetry={history.retry}
    restDayActions={history.canUseRestDays ? {
      saving: history.saving, error: history.saveError, blockReason: history.blockReason, onUse: history.useRestDay,
    } : undefined} />;
}
