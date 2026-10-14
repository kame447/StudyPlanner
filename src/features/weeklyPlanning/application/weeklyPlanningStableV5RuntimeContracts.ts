import type { WeeklyPlanningSemanticTurnObservation } from '../trace/weeklyPlanningSemanticCensusTypes';
import type {
  Actual,
  MonthEvent,
  Plan,
  ScheduleTemplate,
  StudyMaterial,
  TimetableTerm,
} from '../../../types/domain';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningMessage } from '../types';
import type { WeeklyPlanningSelectedStarterTargetV5 } from '../semantic/weeklyPlanningTurnEvidenceV5';
import type { WeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';

export interface ExecuteWeeklyPlanningStableV5RuntimeTurnInput {
  /** Invocation-local Choice/Luna observer; internal only, never serialized or persisted. */
  semanticObservation?: WeeklyPlanningSemanticTurnObservation;
  previousState?: PlanningIntakeState;
  messages: readonly WeeklyPlanningMessage[];
  userText: string;
  supplementalContext?: string;
  selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  monthEvents?: MonthEvent[];
  actuals?: Actual[];
  studyMaterials?: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  conversationId: string;
  traceRequestId: string;
  requestContext: WeeklyPlanningTurnRequestContext;
  /** PlanningState.revision at turn start; binds the previous question presentation. */
  inputStateRevision?: number;
}
