import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import {
  createWeeklyPlanningLegacyRequestContext,
  type WeeklyPlanningTurnRequestContext,
} from './weeklyPlanningTemporalContext';

export interface WeeklyPlanningRequestContextIngressInput {
  requestContext?: WeeklyPlanningTurnRequestContext;
  selectedDate: string;
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
}

export type WeeklyPlanningRequestContextIngressResult =
  | {
      context: WeeklyPlanningTurnRequestContext;
      source: 'captured_request';
    }
  | {
      context: WeeklyPlanningTurnRequestContext;
      source: 'legacy_direct_caller';
    };

function resolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
}

/**
 * Upgrades pre-request-clock direct callers at the public turn ingress.
 * Stable V5 itself must never regenerate temporal context from selectedDate or ambient time.
 */
export function resolveWeeklyPlanningRequestContextAtIngress(
  input: WeeklyPlanningRequestContextIngressInput,
): WeeklyPlanningRequestContextIngressResult {
  if (input.requestContext) {
    return {
      context: input.requestContext,
      source: 'captured_request',
    };
  }

  return {
    context: createWeeklyPlanningLegacyRequestContext({
      selectedDate: input.selectedDate,
      timeZone: resolvedTimeZone(),
      weekStartsOn: input.weekStartsOn ?? 'monday',
    }),
    source: 'legacy_direct_caller',
  };
}
