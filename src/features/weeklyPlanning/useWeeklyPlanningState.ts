import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startOfWeek } from '../../lib/date';
import type { PlanningState, WeeklyPlanningAction } from './types';
import {
  loadOwnedWeeklyPlanningState,
  saveOwnedWeeklyPlanningState,
} from './weeklyPlanningOwnedStorage';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from './weeklyPlanningReducer';

export function useWeeklyPlanningState(userId: string, selectedDate: string) {
  const weekStartDate = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const scopeKey = `${userId}:${weekStartDate}`;
  const [planningState, setPlanningState] = useState<PlanningState>(() =>
    createInitialPlanningState(weekStartDate),
  );
  const planningStateRef = useRef(planningState);
  const planningStateScopeRef = useRef(scopeKey);

  const replacePlanningState = useCallback((nextState: PlanningState, nextScope?: string) => {
    planningStateRef.current = nextState;
    if (nextScope) planningStateScopeRef.current = nextScope;
    setPlanningState(nextState);
    return nextState;
  }, []);

  const dispatchPlanningAction = useCallback((action: WeeklyPlanningAction) => {
    const current = planningStateRef.current;
    const next = weeklyPlanningReducer(current, action);
    if (next !== current) replacePlanningState(next);
    return next;
  }, [replacePlanningState]);

  const getPlanningState = useCallback(() => planningStateRef.current, []);

  useEffect(() => {
    replacePlanningState(
      loadOwnedWeeklyPlanningState(userId, weekStartDate),
      scopeKey,
    );
  }, [replacePlanningState, scopeKey, userId, weekStartDate]);

  useEffect(() => {
    if (planningStateRef.current !== planningState) return;
    if (planningStateScopeRef.current !== scopeKey) return;
    if (planningState.weekStartDate !== weekStartDate) return;
    saveOwnedWeeklyPlanningState(userId, planningState);
  }, [planningState, scopeKey, userId, weekStartDate]);

  return {
    planningState,
    dispatchPlanningAction,
    getPlanningState,
  };
}
