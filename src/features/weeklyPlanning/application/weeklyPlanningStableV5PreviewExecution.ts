import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type {
  WeeklyPlanningPlacementGraphViewV5,
} from '../semantic/weeklyPlanningPlacementGraphViewV5';
import {
  scheduleWeeklyPlanningStableV5Preview,
  WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
} from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
import type { WeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';

export function executeWeeklyPlanningStableV5Preview(params: {
  input: Pick<
    ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
    'plans' | 'scheduleTemplates' | 'timetableTermId' | 'traceRequestId'
  >;
  graph: WeeklyPlanningPlacementGraphViewV5;
  schedulerInput: GenericSchedulerInput;
  requestContext: WeeklyPlanningTurnRequestContext;
  retainPartialCapacityEvidence?: boolean;
}) {
  const previewInput = {
    input: params.schedulerInput,
    graph: params.graph,
    plans: params.input.plans,
    scheduleTemplates: params.input.scheduleTemplates,
    timetableTermId: params.input.timetableTermId,
    notBefore: {
      date: params.requestContext.notBeforeDate,
      time: params.requestContext.notBeforeTime,
    },
    retainPartialCandidates: params.retainPartialCapacityEvidence === true,
  };
  const preview = scheduleWeeklyPlanningStableV5Preview(previewInput);
  recordWeeklyPlanningStableV5DebugTrace({
    requestId: params.input.traceRequestId,
    stage: 'runtime_preview_scheduler_evaluated',
    severity: preview.status === 'ready' ? 'info' : 'warn',
    data: {
      schedulerVersion: WEEKLY_PLANNING_STABLE_V5_PREVIEW_SCHEDULER_VERSION,
      input: previewInput,
      defaultsAndCriteria: {
        dayStartTime: '09:00',
        dayEndTime: '22:00',
        breakMinutes: 10,
        defaultSessionMinutes: 60,
        existingPlanBufferMinutes: 10,
        splittableThresholdMinutes: 120,
        todayNotBefore: `${params.requestContext.notBeforeDate} ${params.requestContext.notBeforeTime}`,
        allOrNothing: 'unscheduled work returns insufficient_capacity; ordinary planning does not expose retained partial candidates as a preview',
      },
      result: {
        ...preview,
        unscheduledWorkItems: preview.unscheduledWorkItemIds,
      },
    },
  });
  return preview;
}
