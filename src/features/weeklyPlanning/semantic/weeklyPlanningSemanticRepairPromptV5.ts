import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const PRESERVE_VALID_MEANING_CLAUSE =
  'Correct every listed validation failure. Treat listed validation failures cumulatively. Preserve unrelated supported current-turn facts and schema-valid fields from the invalid response. Re-read userText for supported omissions.';

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
  if (errors.some((error) => error.includes('canonical-expression'))) {
    directives.push('Encode dateExpression in Stable V5 canonical syntax while preserving the exact user meaning: use ISO YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD, symbolic today/tomorrow/day_after_tomorrow/yesterday/this_week/next_week, weekday:sunday through weekday:saturday, or custom:<text> only when no canonical form applies. For weekday-only meaning use weekday:<english-weekday>; never emit a bare localized weekday and never invent an absolute date.');
  }
  if (errors.some((error) => error.includes('sourceText:not-grounded-in-current-user-text'))) {
    directives.push('For every rejected sourceText, copy an exact contiguous substring from current userText that directly supports that fact; do not paraphrase, synthesize, or reuse prior-turn/stored text. If current userText does not support that fact, remove only that unsupported fact.');
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
    directives.push('Declare missing replacement facts stated in currentUserText in a schema-valid task/component and keep valid fields. Point correction.replacementLocalId to each fresh localId. Reuse exact existingPublicIds only for accepted parent identity; targetLocalId must reference a fresh localId declared here.');
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
