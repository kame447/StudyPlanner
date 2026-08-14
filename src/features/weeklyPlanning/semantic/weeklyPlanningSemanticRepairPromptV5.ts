import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function repairDirectivesForErrors(errors: string[]): string[] {
  const directives: string[] = [];

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
  if (directives.length === 0) {
    directives.push('Correct only the listed validation failures; preserve unrelated current-turn meaning.');
  }
  return unique(directives);
}

export function createWeeklyPlanningSemanticRepairMessagesV5(params: {
  baseMessages: ChatMessage[];
  invalidResponse: string;
  validationErrors: string[];
}): ChatMessage[] {
  const repairInstruction: ChatMessage = {
    role: 'user',
    content: JSON.stringify({
      requiredChanges: repairDirectivesForErrors(params.validationErrors),
      validationErrors: params.validationErrors,
    }),
  };
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.invalidResponse },
    repairInstruction,
  ];
}
