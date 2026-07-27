import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  resetWeeklyPlanningControlledSession,
  resetWeeklyPlanningControllerSession,
  type WeeklyPlanningControllerSession,
} from '../weeklyPlanningTurnController';
import { isWeeklyPlanningStableV5RuntimeEnabled } from './weeklyPlanningRuntimeMode';
import {
  clearWeeklyPlanningStableV5RuntimeSession,
  clearWeeklyPlanningStableV5RuntimeSessionsForScope,
  hydrateWeeklyPlanningStableV5RuntimeSession,
} from './weeklyPlanningStableV5RuntimeSession';
import {
  clearWeeklyPlanningStableV5PersistedSession,
  loadWeeklyPlanningStableV5PersistedSession,
  type WeeklyPlanningStableV5PersistedSession,
} from './weeklyPlanningStableV5SessionStorage';

export interface WeeklyPlanningSessionLifecycleServices {
  isStableV5Enabled: typeof isWeeklyPlanningStableV5RuntimeEnabled;
  loadPersistedSession: typeof loadWeeklyPlanningStableV5PersistedSession;
  hydrateRuntimeSession: typeof hydrateWeeklyPlanningStableV5RuntimeSession;
  clearPersistedSession: typeof clearWeeklyPlanningStableV5PersistedSession;
  clearRuntimeSession: typeof clearWeeklyPlanningStableV5RuntimeSession;
  clearRuntimeSessionsForScope: typeof clearWeeklyPlanningStableV5RuntimeSessionsForScope;
  resetControllerSession: typeof resetWeeklyPlanningControllerSession;
  resetControlledSession: typeof resetWeeklyPlanningControlledSession;
}

const defaultServices: WeeklyPlanningSessionLifecycleServices = {
  isStableV5Enabled: isWeeklyPlanningStableV5RuntimeEnabled,
  loadPersistedSession: loadWeeklyPlanningStableV5PersistedSession,
  hydrateRuntimeSession: hydrateWeeklyPlanningStableV5RuntimeSession,
  clearPersistedSession: clearWeeklyPlanningStableV5PersistedSession,
  clearRuntimeSession: clearWeeklyPlanningStableV5RuntimeSession,
  clearRuntimeSessionsForScope: clearWeeklyPlanningStableV5RuntimeSessionsForScope,
  resetControllerSession: resetWeeklyPlanningControllerSession,
  resetControlledSession: resetWeeklyPlanningControlledSession,
};

export interface WeeklyPlanningSessionStateAccess {
  getState(): PlanningState;
  dispatch(action: WeeklyPlanningAction): PlanningState;
}

export interface WeeklyPlanningSessionResetParams extends WeeklyPlanningSessionStateAccess {
  session: WeeklyPlanningControllerSession;
  ownerId: string;
}

export function restoreWeeklyPlanningApplicationSession(
  ownerId: string,
  weekStartDate: string,
  services: WeeklyPlanningSessionLifecycleServices = defaultServices,
): WeeklyPlanningStableV5PersistedSession | null {
  if (!services.isStableV5Enabled()) return null;
  const persisted = services.loadPersistedSession({ ownerId, weekStartDate });
  if (!persisted) return null;
  services.hydrateRuntimeSession({
    ownerId,
    weekStartDate,
    conversationId: persisted.conversationId,
    graph: persisted.graph,
    updatedAt: Date.parse(persisted.savedAt),
  });
  return persisted;
}

export function synchronizeWeeklyPlanningApplicationSession(params: {
  session: WeeklyPlanningControllerSession;
  ownerId: string;
  weekStartDate: string;
  services?: WeeklyPlanningSessionLifecycleServices;
}): WeeklyPlanningStableV5PersistedSession | null {
  const services = params.services ?? defaultServices;
  const restored = restoreWeeklyPlanningApplicationSession(
    params.ownerId,
    params.weekStartDate,
    services,
  );
  const scopeChanged = params.session.ownerId !== params.ownerId
    || params.session.weekStartDate !== params.weekStartDate;
  const conversationChanged = Boolean(
    restored?.conversationId && params.session.conversationId !== restored.conversationId,
  );
  if (scopeChanged || conversationChanged) {
    services.resetControllerSession(
      params.session,
      params.ownerId,
      params.weekStartDate,
      restored?.conversationId,
    );
  }
  return restored;
}

export function resetWeeklyPlanningApplicationForRuntimeModeChange(
  params: WeeklyPlanningSessionResetParams,
  services: WeeklyPlanningSessionLifecycleServices = defaultServices,
): PlanningState {
  const weekStartDate = params.getState().weekStartDate;
  services.clearPersistedSession({ ownerId: params.ownerId, weekStartDate });
  services.clearRuntimeSession(params.session.conversationId);
  return services.resetControlledSession(params);
}

export function resetWeeklyPlanningApplicationSession(
  params: WeeklyPlanningSessionResetParams,
  services: WeeklyPlanningSessionLifecycleServices = defaultServices,
): PlanningState {
  const weekStartDate = params.getState().weekStartDate;
  services.clearPersistedSession({ ownerId: params.ownerId, weekStartDate });
  services.clearRuntimeSession(params.session.conversationId);
  services.clearRuntimeSessionsForScope({ ownerId: params.ownerId, weekStartDate });
  return services.resetControlledSession(params);
}
