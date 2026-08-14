import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';
import {
  readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5,
} from './weeklyPlanningWorkBreakdownResponseContractV5';

export interface WeeklyPlanningSemanticRepairInputV5 {
  userText: string;
  publicStateSummary?: Record<string, unknown>;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function repairDirectivesForErrors(
  errors: string[],
  input: WeeklyPlanningSemanticRepairInputV5,
): string[] {
  const directives: string[] = [];
  const pendingWorkBreakdownTarget =
    readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5(input.publicStateSummary);

  if (pendingWorkBreakdownTarget) {
    directives.push(`Resolve only pending work_breakdown target ${pendingWorkBreakdownTarget}; bind that existingPublicId and emit only current-userText structure for it. Do not replay unrelated state.`);
  }
  if (errors.some((error) => error.includes('canonical-relative-'))) {
    directives.push('Choose the canonical relative-day/week value matching current meaning and context.');
  }
  if (errors.some((error) =>
    error.includes(':missing-start')
    || error.includes(':missing-end')
    || error.includes(':missing-interval')
    || error.includes(':missing-deadline'))) {
    directives.push('Remove or change unsupported temporal constraints; do not invent missing date/time bounds.');
  }
  if (errors.some((error) =>
    error.includes('explicit clock text must use startTime/endTime')
    || error.includes('do not encode clock times as a custom namedTimePeriod'))) {
    directives.push('Put explicit clock evidence in startTime/endTime, keep namedTimePeriod null, and invent no bounds.');
  }
  if (errors.some((error) => error.includes('targetLocalId'))) {
    directives.push('Use a fresh localId declared in this response as targetLocalId; never use a public Fact ID there.');
  }
  if (errors.some((error) => error.includes('.replacementLocalId:unknown:'))) {
    directives.push('Create only the replacement fact stated in currentUserText inside the minimal schema-valid containing task/component, then point correction.replacementLocalId to its fresh localId. Reuse exact existingPublicIds only for accepted parent identity; every targetLocalId must reference a fresh localId declared in this response.');
  }
  if (errors.some((error) => error.includes('existing-task-binding-required') || error.includes('existing-component-binding-required') || error.includes('unknown-active-task') || error.includes('unknown-active-component') || error.includes('component-task-binding-mismatch'))) {
    directives.push('Bind continued accepted task/component identity with its exact existingPublicId; null is only for a genuinely new entity.');
  }
  if (errors.some((error) => error.includes('explicit-recurrence-missing'))) {
    directives.push('If current userText states recurrence, emit matching recurrence on that same target; periodExpression alone is not recurrence.');
  }
  if (errors.some((error) => error.includes('document.relations') && (error.includes('fromLocalId') || error.includes('toLocalId')))) {
    directives.push('Emit relations only for stated order/dependency/priority and reference task localIds only.');
  }
  if (errors.some((error) => error.includes('ambiguous-standalone-modifier-target'))) {
    directives.push('Remove the guessed modifier attachment and emit one modifier_target uncertainty; preserve unrelated current-turn facts.');
  }
  if (errors.some((error) => error.includes('not-grounded-in-current-user-text'))) {
    directives.push('Remove prior-turn facts not grounded in currentUserText; preserve unrelated valid current-turn facts and invent nothing.');
  }
  if (directives.length === 0) {
    directives.push('Correct only the listed validation failures; preserve unrelated current-turn meaning.');
  }
  return unique(directives);
}

export function createWeeklyPlanningSemanticRepairMessagesV5(params: {
  baseMessages: ChatMessage[];
  invalidResponse: string;
  validationErrors: string[];
  input: WeeklyPlanningSemanticRepairInputV5;
}): ChatMessage[] {
  const repairInstruction: ChatMessage = {
    role: 'user',
    content: JSON.stringify({
      instruction: 'Return only the corrected current-turn Stable V5 semantic delta. Invent nothing.',
      requiredChanges: repairDirectivesForErrors(params.validationErrors, params.input),
      validationErrors: params.validationErrors,
    }),
  };
  const freshContextualRepair = Boolean(
    readWeeklyPlanningPendingWorkBreakdownTargetPublicIdV5(params.input.publicStateSummary),
  );
  if (freshContextualRepair) {
    return [...params.baseMessages, repairInstruction];
  }
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.invalidResponse },
    repairInstruction,
  ];
}
