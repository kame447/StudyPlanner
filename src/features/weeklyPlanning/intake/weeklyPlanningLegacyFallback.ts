import {
  assessWeeklyPlanningRequest,
  looksLikeWeeklyPlanningRequest,
  mergeWeeklyPlanningRevision,
} from '../weeklyPlanningTransforms';
import type {
  PlanningIntakeState,
  StudyScopeUnit,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';
import { addMissing } from './weeklyPlanningMissingStatus';

function mapWeeklyAmountUnit(unit: string): StudyScopeUnit {
  switch (unit) {
    case "minutes":
    case "words":
    case "pages":
    case "problems":
      return unit;
    case "passages":
      return "lessons";
    case "chapter":
      return "chapters";
    case "items":
    case "material":
    case "years":
    default:
      return "unknown";
  }
}

export function applyLegacyWeeklyPlanningFallback(params: {
  state: PlanningIntakeState;
  previousState: PlanningIntakeState | undefined;
  userText: string;
  context: WeeklyPlanningIntakeContext;
}): PlanningIntakeState {
  const { previousState, userText, context } = params;
  let nextState = params.state;

  // TODO(Phase 9.8): keep the legacy weekly parser fallback isolated until the normal/weekly route regression set is expanded.
  if (
    nextState.intent === 'unknown' &&
    looksLikeWeeklyPlanningRequest(userText)
  ) {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: context.selectedDate,
      text: userText,
    });
    nextState = {
      ...nextState,
      intent: 'weekly_study_planning',
      tasks: assessment.tasks.map((task) => ({
        title: task.title,
        subject: task.title,
        unit: mapWeeklyAmountUnit(task.amount.unit),
        amount: task.amount.value,
        rawText: task.sourceText,
        requiresTimeEstimate: task.requiresTimeEstimate,
      })),
      missing: assessment.kind === 'ready' ? nextState.missing : addMissing(nextState.missing, ['life_constraints']),
    };
  } else if (previousState && nextState.intent === 'weekly_study_planning') {
    // previousState truthiness is part of the current behavior. The pipeline can
    // pass a truthy initial state even for a first user-visible turn.
    const revision = mergeWeeklyPlanningRevision({
      selectedDate: context.selectedDate,
      previousText: previousState.sourceTurns.join('\u3001'),
      revisionText: userText,
    });

    if (revision.tasks.length > 0 && !nextState.examPrepScope) {
      nextState = {
        ...nextState,
        tasks: revision.tasks.map((task) => ({
          title: task.title,
          subject: task.title,
          unit: mapWeeklyAmountUnit(task.amount.unit),
          amount: task.amount.value,
          rawText: task.sourceText,
          requiresTimeEstimate: task.requiresTimeEstimate,
        })),
      };
    }
  }

  return nextState;
}
