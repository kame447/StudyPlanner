import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';
import { conversationArchitecturePolicy, type WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const PRESERVE_VALID_MEANING_CLAUSE =
  'Correct every listed validation failure. Treat listed validation failures cumulatively. Preserve unrelated supported current-turn facts and schema-valid fields from the invalid response. Re-read userText for supported omissions.';

const CANONICAL_DATE_REMINDER =
  'Any dateExpression you write must be canonical: YYYY-MM-DD, YYYY-MM-DD/YYYY-MM-DD, today/tomorrow/this_week/next_week, weekday:<english-weekday>, or custom:<text> only when none applies.';

function repairDirectivesForErrors(errors: string[], architecture?: WeeklyPlanningConversationArchitecture): string[] {
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
    // Keep the historical comparison prompt verbatim; current repair must match the
    // slash-separated range accepted by the calendar resolver.
    const current = conversationArchitecturePolicy(architecture).semanticConversationActs;
    const range = current ? 'YYYY-MM-DD/YYYY-MM-DD' : 'YYYY-MM-DD..YYYY-MM-DD';
    // A recurring weekday set has no single dateExpression; current repair restates it in
    // the same availability's days, or as one task preferred window per weekday.
    const weekdaySet = current
      ? ' A recurring weekday set (every weekday, weekends, or several weekdays each week) is not one dateExpression: on an availability declaration with no recurrenceKind/days yet put it there with dateExpression null, and never change recurrenceKind/days it already has; on a task preferred_window emit one copy per weekday with weekday:<english-weekday> and a fresh localId, copying every other field including sourceText. Never add recurrence or another fact to express date scope.'
      : '';
    directives.push(`Encode dateExpression in Stable V5 canonical syntax while preserving the exact user meaning: use ISO YYYY-MM-DD or ${range}, symbolic today/tomorrow/day_after_tomorrow/yesterday/this_week/next_week, weekday:sunday through weekday:saturday, or custom:<text> only when no canonical form applies. For weekday-only meaning use weekday:<english-weekday>; never emit a bare localized weekday and never invent an absolute date.${weekdaySet}`);
  }
  if (errors.includes('document.planningWindow:absolute-year-outside-reference-horizon')) {
    directives.push('The absolute planningWindow year is more than ten years from publicStateSummary.calendarContext.currentDate. Reinterpret only that window from current userText and calendar context; choose an in-range year only when supported, and do not invent a date or change unrelated facts.');
  }
  if (errors.some((error) => error.includes('sourceText:not-grounded-in-current-user-text'))) {
    directives.push('For every rejected sourceText, copy an exact contiguous substring from current userText that directly supports that fact; do not paraphrase, synthesize, or reuse prior-turn/stored text. If current userText does not support that fact, remove only that unsupported fact. Quoted or serialized data that the current request explicitly imports or applies does support its planning facts; fix such a citation by copying the data\'s exact characters instead of removing the fact.');
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
    directives.push('Declare missing replacement facts in a schema-valid task/component; keep valid fields. Set correction.replacementLocalId to each fresh localId. Use exact existingPublicIds for accepted parent identity.');
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
  // Interaction: a repair that adds a fact must not add a new representation error, because
  // the one repair cannot fix it (live C on d7b85616 added the deadline as 「金曜日」).
  const preserve = conversationArchitecturePolicy(architecture).semanticConversationActs
    && !errors.some((error) => error.includes('canonical-expression'))
    ? `${PRESERVE_VALID_MEANING_CLAUSE} ${CANONICAL_DATE_REMINDER}`
    : PRESERVE_VALID_MEANING_CLAUSE;
  if (result.length === 0) {
    return [preserve];
  }
  result[0] = `${result[0]} ${preserve}`;
  return result;
}

export function createWeeklyPlanningSemanticRepairMessagesV5(params: {
  baseMessages: ChatMessage[];
  invalidResponse: string;
  validationErrors: string[];
  conversationArchitecture?: WeeklyPlanningConversationArchitecture;
}): ChatMessage[] {
  const repairInstruction: ChatMessage = {
    role: 'user',
    content: JSON.stringify({
      requiredChanges: repairDirectivesForErrors(params.validationErrors, params.conversationArchitecture),
      validationErrors: params.validationErrors,
    }),
  };
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.invalidResponse },
    repairInstruction,
  ];
}
