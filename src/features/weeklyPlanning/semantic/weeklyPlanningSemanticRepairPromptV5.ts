import type { ChatMessage } from '../../../services/ai/openAiCompatibleClient';
import { conversationArchitecturePolicy, type WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const PRESERVE_VALID_MEANING_CLAUSE =
  'Correct every listed validation failure. Treat listed validation failures cumulatively. Preserve unrelated supported current-turn facts and schema-valid fields from the invalid response. Re-read userText for supported omissions.';

const CANONICAL_DATE_REMINDER =
  'Any dateExpression you write must be canonical: YYYY-MM-DD, YYYY-MM-DD/YYYY-MM-DD, today/tomorrow/this_week/next_week, weekday:<english-weekday>, or custom:<text> only when none applies.';

const UNGROUNDED_SOURCE_PATH = /^document\.tasks\[(\d+)\](?:\.[A-Za-z]+(?:\[\d+\])?)*\.sourceText(?::.*)?$/;

/**
 * Whether a rejected quote (empty — reported without a suffix — or ungrounded) sits under a task the invalid response bound to an accepted fact
 * (existingPublicId). Typed structure of the response only: the model restated an accepted
 * entity instead of returning just the current turn's changes (live D T3).
 */
function ungroundedQuoteUnderAcceptedTask(errors: string[], invalidResponse: string | undefined): boolean {
  if (!invalidResponse) return false;
  let tasks: unknown;
  try {
    tasks = (JSON.parse(invalidResponse) as { tasks?: unknown }).tasks;
  } catch {
    return false;
  }
  if (!Array.isArray(tasks)) return false;
  return errors.some((error) => {
    const match = UNGROUNDED_SOURCE_PATH.exec(error);
    const task = match ? tasks[Number(match[1])] as { existingPublicId?: unknown } | undefined : undefined;
    return typeof task?.existingPublicId === 'string' && task.existingPublicId.length > 0;
  });
}

function repairDirectivesForErrors(
  errors: string[],
  architecture?: WeeklyPlanningConversationArchitecture,
  invalidResponse?: string,
): string[] {
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
  if (conversationArchitecturePolicy(architecture).semanticConversationActs
    && errors.some((error) => error.includes('must-be-null-for-date-rule') || error.includes('date-rule-cannot-have-clock'))) {
    // Live H on b3204cdd: 「水曜の夜にまとめて」 lost 「夜」 when the repair cleared the date rule's period.
    directives.push('A date rule (allowed_date/excluded_date) has no time of day: keep it with null namedTimePeriod/startTime/endTime, and keep the stated time of day as a separate preferred_window (avoid_window when it excludes) on the same task, date and sourceText. Never drop the stated time of day.');
  }
  if (errors.includes('document.planningWindow:absolute-year-outside-reference-horizon')) {
    directives.push('The absolute planningWindow year is more than ten years from publicStateSummary.calendarContext.currentDate. Reinterpret only that window from current userText and calendar context; choose an in-range year only when supported, and do not invent a date or change unrelated facts.');
  }
  if (errors.some((error) => error.includes('sourceText:not-grounded-in-current-user-text'))) {
    directives.push('For every rejected sourceText, copy an exact contiguous substring from current userText that directly supports that fact; do not paraphrase, synthesize, or reuse prior-turn/stored text. If current userText does not support that fact, remove only that unsupported fact. Quoted or serialized data that the current request explicitly imports or applies does support its planning facts; fix such a citation by copying the data\'s exact characters instead of removing the fact.');
  }
  if (conversationArchitecturePolicy(architecture).semanticConversationActs
    && ungroundedQuoteUnderAcceptedTask(errors, invalidResponse)) {
    // Live D T3: both the reading and its repair restated accepted facts with empty or stale quotes.
    directives.push('A rejected or empty quote sits under an accepted entity bound by existingPublicId. Do not restate it: keep its title/category/label/role exactly as in publicStateSummary, omit its unchanged accepted workloads, efforts and constraints, and return only the facts currentUserText adds or changes, each quoted from currentUserText.');
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
    directives.push(conversationArchitecturePolicy(architecture).semanticConversationActs
      ? 'Emit missing replacement facts with corrected kind and referenced correction.replacementLocalId as fresh localId in schema-valid task/component; keep valid fields, exact existingPublicIds, or drop the correction if no change is meant.'
      : 'Declare missing replacement facts in a schema-valid task/component; keep valid fields. Set correction.replacementLocalId to each fresh localId. Use exact existingPublicIds for accepted parent identity.');
  }
  if (errors.some((error) => error.includes('.replacementLocalId:support-not-installed:'))) {
    directives.push('A new fact that a replacement hangs from must be installed by a correction. If that new workload replaces an accepted workload, add a replace correction for it (exact publicId) with the new workload as replacementLocalId; if it is additional work, keep it as new work and attach the corrected session to its original target.');
  }
  if (errors.some((error) => error.includes(':duplicate-of:'))) {
    directives.push('Facts that differ only by localId are duplicates. For a recurring weekday set give each copy its own dateExpression weekday:<english-weekday>; otherwise keep one copy.');
  }
  if (errors.some((error) => error.includes('.replacementLocalId:kind-mismatch:'))) {
    directives.push('A correction replaces a fact with a new fact of the same kind. To add a material or other component to an accepted task, emit the new component without any correction; change a task only with a replacement task. Keep the new fact.');
  }
  if (conversationArchitecturePolicy(architecture).semanticConversationActs
    && errors.some((error) => error.includes('.replacementLocalId:forbidden'))) {
    // Live B on b2fbd121: the repair cleared the replacement but kept a remove of the task.
    directives.push('A remove correction has no replacementLocalId. To replace an accepted fact use operation replace with a same-kind replacement; to name, add or answer something for an accepted task (for example which material), keep the task and add the fact without any correction. Remove only what the user retracts.');
  }
  if (errors.some((error) => error.includes('.replacementLocalId:unsupported-kind:'))) {
    directives.push('A task, component or relation is never replaced by a correction. To name or rename an accepted material, return that component with its existingPublicId and the new label and no correction; add other new work as a new component without a correction.');
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
      requiredChanges: repairDirectivesForErrors(params.validationErrors, params.conversationArchitecture, params.invalidResponse),
      validationErrors: params.validationErrors,
    }),
  };
  return [
    ...params.baseMessages,
    { role: 'assistant', content: params.invalidResponse },
    repairInstruction,
  ];
}
