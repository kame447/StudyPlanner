import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const PRESERVE_VALID_MEANING_CLAUSE =
  'Fix listed validation failures. Preserve unrelated supported current-turn facts and schema-valid fields from the invalid response. Re-read userText for supported omissions.';

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
    directives.push('Declare missing replacement facts stated in currentUserText in a schema-valid task/component; keep valid fields. Set correction.replacementLocalId to each fresh localId. Use exact existingPublicIds only for accepted parent identity; targetLocalId uses fresh localIds.');
  }
  if (errors.some((error) => error.includes('.target:requires-id'))) {
    directives.push('A correction target must use an exact existing publicId or a localId declared in this response; mention alone is not a target. If currentUserText introduces a new fact instead of changing an identified fact, remove that correction and keep the new fact.');
  }
  if (errors.some((error) => error.includes('effort-measurement-mismatch'))) {
    directives.push('Effort measurement kinds are independent facts. Do not replace one measurement kind with a different kind. If currentUserText adds another measurement, remove that replace correction and keep the new effort fact; if it explicitly retracts the old measurement, use a separate remove correction for the exact old target.');
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

  const result = unique(directives);
  if (result.length === 0) {
    return [PRESERVE_VALID_MEANING_CLAUSE];
  }
  result[0] = `${result[0]} ${PRESERVE_VALID_MEANING_CLAUSE}`;
  return result;
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
