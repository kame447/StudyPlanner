import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startOfWeek } from '../../lib/date';
import type { PlanningState, WeeklyPlanningAction } from './types';
import {
  loadWeeklyPlanningState,
  saveWeeklyPlanningState,
} from './weeklyPlanningStorage';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from './weeklyPlanningReducer';

export function useWeeklyPlanningState(userId: string, selectedDate: string) {
  const weekStartDate = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const [planningState, setPlanningState] = useState<PlanningState>(() =>
    createInitialPlanningState(weekStartDate),
  );
  const planningStateRef = useRef(planningState);

  const replacePlanningState = useCallback((nextState: PlanningState) => {
    planningStateRef.current = nextState;
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
    replacePlanningState(loadWeeklyPlanningState(userId, weekStartDate));
  }, [replacePlanningState, userId, weekStartDate]);

  useEffect(() => {
    if (planningState.weekStartDate !== weekStartDate) return;
    saveWeeklyPlanningState(userId, planningState);
  }, [planningState, userId, weekStartDate]);

  return {
    planningState,
    dispatchPlanningAction,
    getPlanningState,
  };
}
