import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  resetWeeklyPlanningControlledSession,
  resetWeeklyPlanningControllerSession,
  type WeeklyPlanningControllerSession,
} from '../weeklyPlanningTurnController';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
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
  loadPersistedSession: typeof loadWeeklyPlanningStableV5PersistedSession;
  hydrateRuntimeSession: typeof hydrateWeeklyPlanningStableV5RuntimeSession;
  bindRuntimeSessionScope: typeof bindWeeklyPlanningStableV5RuntimeSessionScope;
  clearPersistedSession: typeof clearWeeklyPlanningStableV5PersistedSession;
  clearRuntimeSession: typeof clearWeeklyPlanningStableV5RuntimeSession;
  clearRuntimeSessionsForScope: typeof clearWeeklyPlanningStableV5RuntimeSessionsForScope;
  resetControllerSession: typeof resetWeeklyPlanningControllerSession;
  resetControlledSession: typeof resetWeeklyPlanningControlledSession;
}

const defaultServices: WeeklyPlanningSessionLifecycleServices = {
  loadPersistedSession: loadWeeklyPlanningStableV5PersistedSession,
  hydrateRuntimeSession: hydrateWeeklyPlanningStableV5RuntimeSession,
  bindRuntimeSessionScope: bindWeeklyPlanningStableV5RuntimeSessionScope,
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
  const ownerChanged = params.session.ownerId !== params.ownerId;
  let restored: WeeklyPlanningStableV5PersistedSession | null = null;

  if (ownerChanged) {
    restored = restoreWeeklyPlanningApplicationSession(
      params.ownerId,
      params.weekStartDate,
      services,
    );
    services.resetControllerSession(
      params.session,
      params.ownerId,
      params.weekStartDate,
      restored?.conversationId,
    );
  } else if (params.session.weekStartDate !== params.weekStartDate) {
    params.session.weekStartDate = params.weekStartDate;
  }

  services.bindRuntimeSessionScope({
    ownerId: params.ownerId,
    weekStartDate: params.weekStartDate,
    conversationId: params.session.conversationId,
  });
  return restored;
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
