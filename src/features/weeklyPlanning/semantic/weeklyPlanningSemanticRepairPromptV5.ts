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
    directives.push(`Resolve only the pending work_breakdown target ${pendingWorkBreakdownTarget}. Return exactly that task with existingPublicId=${pendingWorkBreakdownTarget} and only structure supported by current userText. Do not replay the planning window, unrelated tasks, stored context, relations, or the old uncertainty.`);
  }
  if (errors.some((error) => error.includes('canonical-relative-'))) {
    directives.push('Choose the canonical relative-day or relative-week value that matches the user meaning and conversation context.');
  }
  if (errors.some((error) =>
    error.includes(':missing-start')
    || error.includes(':missing-end')
    || error.includes(':missing-interval')
    || error.includes(':missing-deadline'))) {
    directives.push('Remove or change unsupported temporal constraints instead of inventing a missing clock or date boundary.');
  }
  if (errors.some((error) =>
    error.includes('explicit clock text must use startTime/endTime')
    || error.includes('do not encode clock times as a custom namedTimePeriod'))) {
    directives.push('Interpret the explicit clock expression into startTime/endTime and leave namedTimePeriod null; do not invent clock bounds not supported by userText.');
  }
  if (errors.some((error) => error.includes('targetLocalId'))) {
    directives.push('Resolve references semantically, then use a localId declared in this response as targetLocalId. Never copy a public Fact ID into targetLocalId.');
  }
  if (errors.some((error) => error.includes('.replacementLocalId:unknown:'))) {
    directives.push("Create the replacement fact stated by current userText in the appropriate current-document collection, then set correction.replacementLocalId to that fact's declared localId. If it is nested under an accepted task or component, include the minimal schema-valid containing task/component with fresh localIds and the exact existingPublicIds from publicStateSummary; keep the task title non-empty and include study details for a study task. Set every targetLocalId to a fresh localId declared in this response, never a public Fact ID. Do not leave a dangling localId, copy the old fact, or invent replacement meaning.");
  }
  if (errors.some((error) => error.includes('existing-task-binding-required') || error.includes('existing-component-binding-required') || error.includes('unknown-active-task') || error.includes('unknown-active-component') || error.includes('component-task-binding-mismatch'))) {
    directives.push('Bind continued accepted task/component identity with the exact existingPublicId from publicStateSummary; keep null only for genuinely new entities.');
  }
  if (errors.some((error) => error.includes('explicit-recurrence-missing'))) {
    directives.push('If current userText states recurring cadence, emit the matching recurrence for that same semantic target; periodExpression alone does not express recurrence.');
  }
  if (errors.some((error) => error.includes('document.relations') && (error.includes('fromLocalId') || error.includes('toLocalId')))) {
    directives.push('Emit a task relation only when the user stated scheduling order, dependency, or priority, and reference task localIds only.');
  }
  if (errors.some((error) => error.includes('ambiguous-standalone-modifier-target'))) {
    directives.push('The standalone modifier has no uniquely supported target. Remove the guessed attachment and emit one modifier_target uncertainty instead of choosing by order or proximity; preserve unrelated current-turn facts.');
  }
  if (errors.some((error) => error.includes('not-grounded-in-current-user-text'))) {
    directives.push('Return a current-userText delta: remove facts copied from prior turns whose sourceText is not grounded in current userText, preserve unrelated valid current-turn facts, and do not invent replacement evidence.');
  }
  if (directives.length === 0) {
    directives.push('Correct only the listed validation failures while preserving all unrelated current-turn meaning.');
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
      instruction: 'Return the corrected current-turn Stable V5 semantic delta only. Do not invent facts or application decisions.',
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
