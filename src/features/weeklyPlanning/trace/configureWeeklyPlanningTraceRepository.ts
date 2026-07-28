import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import { createRemoteWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRemoteRepository';
import {
  createNoopWeeklyPlanningTraceRepository,
  resolveWeeklyPlanningTraceEnabled,
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';

let configured = false;

export const resolveWeeklyPlanningTraceFeatureEnabled = resolveWeeklyPlanningTraceEnabled;

export function isWeeklyPlanningTraceFeatureEnabled(): boolean {
  return resolveWeeklyPlanningTraceFeatureEnabled(
    import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED,
    import.meta.env.DEV,
  );
}

export function configureWeeklyPlanningTraceRepository(): void {
  if (configured) return;
  configured = true;

  if (!import.meta.env.PROD) return;

  if (!isWeeklyPlanningTraceFeatureEnabled() || !getCloudflareAiProxyUrl().trim()) {
    setWeeklyPlanningTraceRepositoryForTests(createNoopWeeklyPlanningTraceRepository());
    return;
  }

  setWeeklyPlanningTraceRepositoryForTests(
    createRemoteWeeklyPlanningTraceRepository(),
  );
}
