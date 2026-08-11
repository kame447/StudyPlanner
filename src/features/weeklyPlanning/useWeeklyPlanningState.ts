import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  startOfWeeklyPlanningWeek,
  type WeeklyPlanningWeekStartsOn,
} from './personalization/weeklyPlanningWeek';
import type { PlanningState, WeeklyPlanningAction } from './types';
import {
  loadOwnedWeeklyPlanningState,
  saveOwnedWeeklyPlanningState,
} from './weeklyPlanningOwnedStorage';
import { weeklyPlanningReducer } from './weeklyPlanningReducer';

export function useWeeklyPlanningState(
  userId: string,
  selectedDate: string,
  weekStartsOn: WeeklyPlanningWeekStartsOn = 'monday',
) {
  const selectedWeekStartDate = useMemo(
    () => startOfWeeklyPlanningWeek(selectedDate, weekStartsOn),
    [selectedDate, weekStartsOn],
  );
  const [planningState, setPlanningState] = useState<PlanningState>(() =>
    loadOwnedWeeklyPlanningState(userId, selectedWeekStartDate),
  );
  const planningStateRef = useRef(planningState);
  const ownerScopeRef = useRef(userId);

  const replacePlanningState = useCallback((nextState: PlanningState, nextOwnerId?: string) => {
    planningStateRef.current = nextState;
    if (nextOwnerId) ownerScopeRef.current = nextOwnerId;
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
    if (ownerScopeRef.current === userId) return;
    replacePlanningState(
      loadOwnedWeeklyPlanningState(userId, selectedWeekStartDate),
      userId,
    );
  }, [replacePlanningState, selectedWeekStartDate, userId]);

  useEffect(() => {
    if (ownerScopeRef.current !== userId) return;
    const current = planningStateRef.current;
    if (current.weekStartDate === selectedWeekStartDate) return;
    if (current.pendingTurn || current.pendingApproval) return;
    const next = weeklyPlanningReducer(current, {
      type: 'set_week_anchor',
      weekStartDate: selectedWeekStartDate,
    });
    if (next !== current) replacePlanningState(next);
  }, [planningState, replacePlanningState, selectedWeekStartDate, userId]);

  useEffect(() => {
    if (planningStateRef.current !== planningState) return;
    if (ownerScopeRef.current !== userId) return;
    saveOwnedWeeklyPlanningState(userId, planningState);
  }, [planningState, userId]);

  return {
    planningState,
    dispatchPlanningAction,
    getPlanningState,
  };
}
