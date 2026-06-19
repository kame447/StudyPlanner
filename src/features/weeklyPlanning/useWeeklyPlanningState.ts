import { useEffect, useMemo, useReducer } from 'react';
import { startOfWeek } from '../../lib/date';
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
  const [planningState, dispatchPlanningAction] = useReducer(
    weeklyPlanningReducer,
    weekStartDate,
    createInitialPlanningState,
  );

  useEffect(() => {
    dispatchPlanningAction({
      type: 'load_state',
      state: loadWeeklyPlanningState(userId, weekStartDate),
    });
  }, [userId, weekStartDate]);

  useEffect(() => {
    if (planningState.weekStartDate !== weekStartDate) {
      return;
    }

    saveWeeklyPlanningState(userId, planningState);
  }, [planningState, userId, weekStartDate]);

  return {
    planningState,
    dispatchPlanningAction,
  };
}
