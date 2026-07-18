import type { WeeklyPlanningMessage } from '../types';

export function createWeeklyPlanningApplicationRequestId(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createWeeklyPlanningApplicationMessage(
  role: WeeklyPlanningMessage['role'],
  content: string,
): WeeklyPlanningMessage {
  return {
    id: createWeeklyPlanningApplicationRequestId(`weekly-${role}-message`),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}
