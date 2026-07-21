import type { AllowedDialogueAction } from '../planning/weeklyPlanningBehaviorTypes';
import type { WeeklyPlanningQuestionContext } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningBehaviorAwarePipelineOutput } from './weeklyPlanningBehaviorAwareIntakePipeline';

function matchingDecisionQuestion(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
  action: AllowedDialogueAction,
) {
  return output.decision.questionPlan?.find((question) => {
    if (action.topicId === 'planning-range') {
      return question.targetSlot === 'planning_start_date' || question.targetSlot === 'planning_period';
    }
    if (action.topicId === 'task-identity') return question.targetSlot === 'tasks_or_goals';
    if (action.topicId === 'workload-estimate') {
      return question.targetSlot === 'unit_rate' || question.targetSlot === 'unit_duration_estimate';
    }
    if (action.topicId === 'availability-basis') {
      return ['fixed_events', 'sleep_cycle', 'meal_bath_constraints', 'life_constraints']
        .includes(question.targetSlot);
    }
    return false;
  });
}

function contextForAction(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
  action: AllowedDialogueAction,
): WeeklyPlanningQuestionContext | undefined {
  if (action.kind === 'report_infeasibility') {
    return {
      kind: 'feasibility_adjustment',
      targetSlot: 'constraint_relaxation',
      intent: 'ask_constraint_relaxation',
      topicId: action.topicId,
      actionId: action.actionId,
    };
  }
  if (action.kind === 'suggest_draft_generation') {
    return {
      kind: 'approval',
      targetSlot: 'draft_generation_confirmation',
      intent: 'confirm_draft_generation',
      topicId: action.topicId,
      actionId: action.actionId,
    };
  }
  if (action.kind !== 'show_options' && action.kind !== 'ask_required_fact') return undefined;
  const question = matchingDecisionQuestion(output, action);
  let targetSlot = question?.targetSlot;
  if (!targetSlot) {
    if (action.topicId === 'planning-range') {
      targetSlot = output.state.pendingPlanningRange ? 'planning_start_date' : 'planning_period';
    } else if (action.topicId === 'task-identity') {
      targetSlot = 'tasks_or_goals';
    } else if (action.topicId === 'workload-estimate') {
      targetSlot = 'unit_duration_estimate';
    } else if (action.topicId === 'availability-basis') {
      targetSlot = 'availability_basis';
    } else if (action.topicId === 'feasibility_basis') {
      targetSlot = 'feasibility_basis';
    } else if (action.topicId === 'planning-purpose') {
      targetSlot = 'planning_purpose';
    }
  }
  if (!targetSlot) return undefined;
  return {
    kind: action.kind === 'show_options' ? 'options' : 'missing',
    targetSlot,
    intent: question?.intent ?? `clarify_${action.topicId}`,
    topicId: action.topicId,
    actionId: action.actionId,
  };
}

function renderedActionIds(output: WeeklyPlanningBehaviorAwarePipelineOutput): string[] {
  return output.behaviorDialogue.renderedActionIds
    ?? output.behaviorDialogue.response?.items.map((item) => item.actionId)
    ?? [];
}

export function applyRenderedQuestionContext(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
): WeeklyPlanningBehaviorAwarePipelineOutput {
  // Exam flows are rendered from decision.questionPlan after this pipeline returns.
  // Keep the intake pipeline's first-question context instead of overwriting it
  // with behaviorDialogue actions that are not shown to the user.
  if (output.decision.kind === 'answer_clarification' || output.state.examPrepScope) return output;
  let lastQuestionContext: WeeklyPlanningQuestionContext | undefined;
  for (const actionId of renderedActionIds(output)) {
    const action = output.behavior.actions.find((candidate) => candidate.actionId === actionId);
    if (!action) continue;
    lastQuestionContext = contextForAction(output, action);
    if (lastQuestionContext) break;
  }
  output.state.lastQuestionContext = lastQuestionContext;
  return output;
}
