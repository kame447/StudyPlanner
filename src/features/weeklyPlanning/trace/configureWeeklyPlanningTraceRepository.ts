import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import { createRemoteWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRemoteRepository';
import {
  createNoopWeeklyPlanningTraceRepository,
  isWeeklyPlanningTraceEnabled,
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';

let configured = false;

export function configureWeeklyPlanningTraceRepository(): void {
  if (configured) return;
  configured = true;

  if (!isWeeklyPlanningTraceEnabled() || !import.meta.env.PROD) return;

  if (!getCloudflareAiProxyUrl().trim()) {
    setWeeklyPlanningTraceRepositoryForTests(createNoopWeeklyPlanningTraceRepository());
    return;
  }

  setWeeklyPlanningTraceRepositoryForTests(
    createRemoteWeeklyPlanningTraceRepository(),
  );
}
