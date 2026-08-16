import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const PRESERVE_VALID_MEANING_DIRECTIVE =
  'Preserve unrelated supported current-turn facts and schema-valid fields from the invalid response unless a listed error requires changing them.';

function repairDirectivesForErrors(errors: string[]): string[] {
  const directives: string[] = [];

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
  const selfReferentialUncertainty = errors.some((error) =>
    error.includes('document.uncertainties')
    && error.includes('.targetLocalId:self-reference'));
  if (selfReferentialUncertainty) {
    directives.push('Never target an uncertainty at its own localId. If the referent is unresolved, use targetLocalId=document; otherwise target the supported fact localId.');
  } else if (errors.some((error) => error.includes('targetLocalId'))) {
    directives.push('Use a fresh localId declared in this response as targetLocalId; never use a public Fact ID there.');
  }
  if (errors.some((error) => error.includes('.replacementLocalId:unknown:'))) {
    directives.push('Declare each missing replacement fact stated in currentUserText inside a minimal schema-valid containing task/component, preserve existing schema-valid task/component fields, then point correction.replacementLocalId to its fresh localId. Reuse exact existingPublicIds only for accepted parent identity; targetLocalId must reference fresh localIds declared here.');
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
  directives.push(PRESERVE_VALID_MEANING_DIRECTIVE);
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
