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
    directives.push(`This turn answers the pending work_breakdown uncertainty for exact target ${pendingWorkBreakdownTarget}. Return exactly one task, bind it with existingPublicId to that target, and use current-userText evidence on that task. Put newly identified study constituents on that target task and mark it decomposed. Do not emit extra top-level tasks, prior planning state, old uncertainty, user context, or task relations in this focused resolution delta.`);
  }
  if (errors.some((error) => error.includes('canonical-relative-'))) {
    directives.push('Use one allowed canonical relative-day or relative-week value that matches the original utterance and conversation context.');
  }
  if (errors.some((error) =>
    error.includes('document.planningWindow:absolute-range')
    || error.includes('document.planningWindow:absolute-iso-range-required')
    || error.includes('document.planningWindow:absolute-range-order')
    || error.includes('document.planningWindow.value:absolute-canonical-range'))) {
    directives.push('Repair only the malformed absolute planningWindow representation. Interpret the explicit date range from current userText and conversation date context into valid YYYY-MM-DD start/end values, require start <= end, and set value exactly to "<start>/<end>". Preserve planningIntent and every otherwise-valid current-turn task, component, workload, availability declaration, relation, user-context fact, uncertainty, correction, and decision from the invalid response; do not drop unrelated facts while repairing the date range.');
  }
  if (errors.some((error) =>
    error.includes(':missing-start')
    || error.includes(':missing-end')
    || error.includes(':missing-interval')
    || error.includes(':missing-deadline'))) {
    directives.push('Remove or change unsupported temporal constraints instead of inventing a missing clock or date boundary.');
  }
  if (errors.some((error) => error.includes('namedTimePeriod:cannot-combine-with-clock'))) {
    directives.push('Keep either a named time period or exact clock fields, not both.');
  }
  if (errors.some((error) =>
    error.includes('explicit clock text must use startTime/endTime')
    || error.includes('do not encode clock times as a custom namedTimePeriod'))) {
    directives.push('The user stated explicit clock time bounds. Preserve that meaning by putting the normalized HH:mm values in startTime/endTime and set namedTimePeriod to null. Do not encode explicit clock times inside custom:<text>.');
  }
  if (errors.some((error) => error.includes('targetLocalId'))) {
    directives.push('targetLocalId must name a localId declared in the same returned JSON. Never copy a publicStateSummary publicId into targetLocalId. If a pending quantity-role answer selects target, remaining, or completed, remove the uncertainty and emit one minimal local task and workload; pendingQuestion binds the existing public target.');
  }
  if (errors.some((error) => error.includes('existing-task-binding-required') || error.includes('existing-component-binding-required') || error.includes('unknown-active-task') || error.includes('unknown-active-component') || error.includes('component-task-binding-mismatch'))) {
    directives.push('For each continued accepted task/component, set existingPublicId to the exact candidate publicId from publicStateSummary. Keep existingPublicId null only for genuinely new entities. Never duplicate an accepted entity just to add current-turn facts.');
  }
  if (errors.some((error) => error.includes('explicit-recurrence-missing'))) {
    directives.push('When a per-occurrence workload explicitly represents a recurring cadence, add the matching recurrence targeting the same task/component localId. periodExpression does not replace recurrence.');
  }
  if (errors.some((error) => error.includes('work-breakdown-'))) {
    directives.push('This turn answers the pending work_breakdown uncertainty. Return only the exact target task identified by the pending uncertainty targetPublicId, using that ID as existingPublicId. Represent only the current user answer on that task. Do not copy the accepted planning window, unrelated accepted tasks, stored user context, or the old uncertainty. If constituents are identified, use decompositionStatus decomposed and encode them on the target task; if the user clarifies one schedulable unit, use atomic; use needs_breakdown only when the current answer itself remains insufficient.');
  }
  if (errors.some((error) => error.includes('document.relations') && (error.includes('fromLocalId') || error.includes('toLocalId')))) {
    directives.push('Task relations may reference task localIds only. Do not convert a comparison of workload size or amount into priority/order/dependency unless the user explicitly stated that scheduling relation.');
  }
  if (errors.some((error) => error.includes('ambiguous-standalone-modifier-target'))) {
    directives.push('A standalone modifier after multiple listed candidate tasks/components has no unique target. Preserve every otherwise-valid current-turn fact from the invalid response, including its planningWindow and listed tasks/components, but remove the guessed modifier attachment only. Emit exactly one uncertainty for that modifier with targetLocalId exactly "document", field exactly "modifier_target", and the modifier excerpt as sourceText. Never use null or the string "null" for targetLocalId, and do not choose a candidate by order or proximity.');
  }
  if (errors.some((error) => error.includes('not-grounded-in-current-user-text'))) {
    directives.push('Treat the response as a current-userText delta, not a full-plan snapshot. Remove every fact copied from prior turns whose sourceText is not grounded in current userText. Set an unstated planningWindow to null even if publicStateSummary contains one; remove stale collection items instead of replacing their sourceText. Keep newly stated current-turn facts. Preserve unrelated semantic fields that were already valid, including planningIntent, unless a listed validation error specifically invalidates them. Do not invent replacement sourceText.');
  }
  if (errors.some((error) => error.includes('unknown-key') || error.includes('missing-key'))) {
    directives.push('Return exactly the required Stable V5 schema keys with no unknown keys.');
  }
  if (directives.length === 0) {
    directives.push('Correct only the listed schema, type, range, reference, or structural validation failures while preserving the meaning you derived from the original context.');
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
      instruction: 'Return the complete corrected Stable V5 JSON document only. Complete means all required JSON Schema top-level keys are present; it does not mean restating the accepted plan. The document must remain a delta for current userText. Do not invent facts or application decisions.',
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
