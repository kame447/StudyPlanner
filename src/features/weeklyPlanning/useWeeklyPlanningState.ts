import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  startOfWeeklyPlanningWeek,
  type WeeklyPlanningWeekStartsOn,
} from './personalization/weeklyPlanningWeek';
import type { PlanningState, WeeklyPlanningAction } from './types';
import {
  readOwnedWeeklyPlanningState,
  saveOwnedWeeklyPlanningState,
} from './weeklyPlanningOwnedStorage';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';

export function useWeeklyPlanningState(
  userId: string,
  selectedDate: string,
  weekStartsOn: WeeklyPlanningWeekStartsOn = 'monday',
) {
  const selectedWeekStartDate = useMemo(
    () => startOfWeeklyPlanningWeek(selectedDate, weekStartsOn),
    [selectedDate, weekStartsOn],
  );
  const [loaded, setLoaded] = useState(() => {
    const read = readOwnedWeeklyPlanningState(userId, selectedWeekStartDate);
    return { status: read.status, state: read.status === 'ready' ? read.state : createInitialPlanningState(selectedWeekStartDate),
      persistedSession: read.status === 'ready' ? read.persistedSession : null };
  });
  const planningState = loaded.state;
  const planningStateRef = useRef(planningState);
  const loadStatusRef = useRef(loaded.status);
  const loadedSessionRef = useRef(loaded.persistedSession);
  const ownerScopeRef = useRef(userId);

  const isPlanningStateReady = useCallback(() =>
    ownerScopeRef.current === userId && loadStatusRef.current === 'ready', [userId]);

  const replacePlanningState = useCallback((nextState: PlanningState) => {
    planningStateRef.current = nextState;
    loadStatusRef.current = 'ready';
    setLoaded({ status: 'ready', state: nextState, persistedSession: loadedSessionRef.current });
    return nextState;
  }, []);

  const retryPlanningStateLoad = useCallback(() => {
    if (isPlanningStateReady()) return true;
    const read = readOwnedWeeklyPlanningState(userId, selectedWeekStartDate);
    if (read.status === 'unavailable') return false;
    ownerScopeRef.current = userId;
    loadedSessionRef.current = read.persistedSession;
    replacePlanningState(read.state);
    return true;
  }, [isPlanningStateReady, replacePlanningState, selectedWeekStartDate, userId]);

  const dispatchPlanningAction = useCallback((action: WeeklyPlanningAction) => {
    const current = planningStateRef.current;
    if (ownerScopeRef.current !== userId || (!isPlanningStateReady() && action.type !== 'load_state')) return current;
    const next = weeklyPlanningReducer(current, action);
    if (next !== current) replacePlanningState(next);
    return next;
  }, [isPlanningStateReady, replacePlanningState, userId]);

  const getPlanningState = useCallback(() => planningStateRef.current, []);
  const getLoadedSessionSnapshot = useCallback(() => isPlanningStateReady() ? loadedSessionRef.current : null, [isPlanningStateReady]);

  useEffect(() => {
    if (ownerScopeRef.current === userId) return;
    const read = readOwnedWeeklyPlanningState(userId, selectedWeekStartDate);
    const nextState = read.status === 'ready' ? read.state : createInitialPlanningState(selectedWeekStartDate);
    ownerScopeRef.current = userId;
    planningStateRef.current = nextState;
    loadStatusRef.current = read.status;
    loadedSessionRef.current = read.status === 'ready' ? read.persistedSession : null;
    setLoaded({ status: read.status, state: nextState, persistedSession: loadedSessionRef.current });
  }, [selectedWeekStartDate, userId]);

  useEffect(() => {
    if (!isPlanningStateReady()) return;
    const current = planningStateRef.current;
    if (current.weekStartDate === selectedWeekStartDate) return;
    if (current.pendingTurn || current.pendingApproval) return;
    const next = weeklyPlanningReducer(current, {
      type: 'set_week_anchor',
      weekStartDate: selectedWeekStartDate,
    });
    if (next !== current) replacePlanningState(next);
  }, [isPlanningStateReady, planningState, replacePlanningState, selectedWeekStartDate]);

  useEffect(() => {
    if (planningStateRef.current !== planningState) return;
    if (!isPlanningStateReady()) return;
    saveOwnedWeeklyPlanningState(userId, planningState);
  }, [isPlanningStateReady, planningState, userId]);

  return {
    planningState,
    isPlanningStateReady,
    retryPlanningStateLoad,
    getLoadedSessionSnapshot,
    dispatchPlanningAction,
    getPlanningState,
  };
}
