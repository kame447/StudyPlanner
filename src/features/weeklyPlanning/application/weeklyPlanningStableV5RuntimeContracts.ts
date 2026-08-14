import type { Plan, ScheduleTemplate } from '../../../types/domain';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';
import type { WeeklyPlanningMessage } from '../types';
import type { WeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';

export interface ExecuteWeeklyPlanningStableV5RuntimeTurnInput {
  previousState?: PlanningIntakeState;
  messages: readonly WeeklyPlanningMessage[];
  userText: string;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  conversationId: string;
  traceRequestId: string;
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
  requestContext?: WeeklyPlanningTurnRequestContext;
}
