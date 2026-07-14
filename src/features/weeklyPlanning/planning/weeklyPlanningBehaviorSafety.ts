import type { PlanningIntakeState, StudyTaskScope } from '../intake/weeklyPlanningIntakeTypes';
import {
  createAllowedDialogueActions,
  deriveMissingResolutionOpportunities,
  type AvailabilityRangeReference,
} from './weeklyPlanningBehaviorPlanner';
import type {
  AllowedDialogueAction,
  BehaviorAwareDialogueResponse,
  PlanningDimension,
  PlanningHypothesisSnapshot,
  PreviewGateResult,
} from './weeklyPlanningBehaviorTypes';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
const DEADLINE_SIGNAL = /(?:小テスト|テスト|試験|締切|期限|提出|までに|まで)/;
const EXPLICIT_DATE = /(?:20\d{2}[年/-])?\d{1,2}[月/-]\d{1,2}日?/;
const WEEKDAY = /([日月火水木金土])曜(?:日)?/;
const INTERNAL_TERM = /(?:blockingDimensions|reasonCode|readiness|suitability|sourceFactRefs|proposalRef|slotKey)/i;
const SAVE_CLAIM = /(?:保存しました|確定しました|登録しました|予定に追加しました)/;

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function addDimension(items: PlanningDimension[], dimension: PlanningDimension): PlanningDimension[] {
  return items.includes(dimension) ? items : [...items, dimension];
}

function removeDimension(items: PlanningDimension[], dimension: PlanningDimension): PlanningDimension[] {
  return items.filter((item) => item !== dimension);
}

function taskLabels(task: StudyTaskScope): string[] {
  const title = task.title.trim();
  return title ? [title] : [];
}

function taskDeadlineEvidence(task: StudyTaskScope, state: PlanningIntakeState): string[] {
  const labels = taskLabels(task);
  if (labels.length === 0) return [];

  const candidateTexts = unique([task.rawText, ...state.sourceTurns]);
  return candidateTexts.flatMap((text) =>
    text
      .split(/[、。,.\n]/)
      .map((clause) => clause.trim())
      .filter((clause) =>
        Boolean(clause)
        && DEADLINE_SIGNAL.test(clause)
        && labels.some((label) => clause.includes(label)),
      ),
  );
}

function weekdayFallsInPlanningRange(text: string, state: PlanningIntakeState): boolean {
  const match = text.match(WEEKDAY);
  const start = state.range?.startDateTime?.slice(0, 10);
  const dayCount = state.range?.calendarDayCount;
  if (!match || !start || !dayCount || dayCount <= 0) return false;

  const target = WEEKDAYS.indexOf(match[1] as typeof WEEKDAYS[number]);
  if (target < 0) return false;
  const startDate = new Date(`${start}T00:00:00`);
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return date.getDay() === target;
  }).some(Boolean);
}

function hasConcreteDeadline(text: string, state: PlanningIntakeState): boolean {
  return EXPLICIT_DATE.test(text) || weekdayFallsInPlanningRange(text, state);
}

export function evaluateDeadlineSafety(state: PlanningIntakeState): {
  required: boolean;
  resolved: boolean;
  sourceFactRefs: string[];
} {
  const evidence = state.tasks.flatMap((task) => taskDeadlineEvidence(task, state));
  if (evidence.length === 0) {
    return { required: false, resolved: false, sourceFactRefs: [] };
  }
  return {
    required: true,
    resolved: evidence.every((text) => hasConcreteDeadline(text, state)),
    sourceFactRefs: evidence.map((_, index) => `deadline-evidence:${index}`),
  };
}

function range(
  ref: string,
  startTime: string,
  endTime: string,
  sourceFactRefs: string[],
): AvailabilityRangeReference | null {
  if (!startTime || !endTime || startTime >= endTime) return null;
  return { ref, startTime, endTime, sourceFactRefs };
}

export function deriveCanonicalAvailabilityRanges(params: {
  state: PlanningIntakeState;
  dayStartTime: string;
  dayEndTime: string;
}): AvailabilityRangeReference[] {
  const ranges: AvailabilityRangeReference[] = [];
  const sources = params.state.constraintSourcesInUse ?? [];

  if (sources.length > 0) {
    const sourceRange = range(
      'validated-schedule-sources',
      params.dayStartTime,
      params.dayEndTime,
      sources.map((source) => `constraint-source:${source.kind}`),
    );
    if (sourceRange) ranges.push(sourceRange);
  }

  params.state.constraints.forEach((constraint, index) => {
    if (constraint.studyAvailableStart) {
      const explicitRange = range(
        `study-available-start:${index}`,
        constraint.studyAvailableStart,
        params.dayEndTime,
        [`constraint:${index}`],
      );
      if (explicitRange) ranges.push(explicitRange);
    }
  });

  const commute = params.state.constraints.find((constraint) =>
    constraint.kind === 'commute' && Boolean(constraint.end),
  );
  const meal = params.state.constraints.find((constraint) =>
    constraint.kind === 'meal' && Boolean(constraint.start || constraint.end),
  );

  if (commute?.end && meal?.start) {
    const beforeMeal = range('anchor-window:after-commute', commute.end, meal.start, [
      `constraint:${params.state.constraints.indexOf(commute)}`,
      `constraint:${params.state.constraints.indexOf(meal)}`,
    ]);
    if (beforeMeal) ranges.push(beforeMeal);
  }
  if (meal?.end) {
    const afterMeal = range('anchor-window:after-meal', meal.end, params.dayEndTime, [
      `constraint:${params.state.constraints.indexOf(meal)}`,
    ]);
    if (afterMeal) ranges.push(afterMeal);
  }

  const seen = new Set<string>();
  return ranges.filter((item) => {
    const key = `${item.startTime}-${item.endTime}-${item.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function suggestedNextAction(params: {
  blocking: PlanningDimension[];
  draftGenerationIntent: 'not_requested' | 'user_authorized';
  fallback: PlanningHypothesisSnapshot['suggestedNextAction'];
}): PlanningHypothesisSnapshot['suggestedNextAction'] {
  if (params.blocking.includes('deadline')) return 'ask_required_fact';
  if (params.blocking.includes('availability_basis')) return 'offer_options';
  if (params.blocking.length === 0 && params.draftGenerationIntent === 'user_authorized') {
    return 'generate_preview';
  }
  if (params.blocking.length === 0) return 'suggest_draft_generation';
  return params.fallback;
}

export function hardenPlanningSnapshot(params: {
  snapshot: PlanningHypothesisSnapshot;
  state: PlanningIntakeState;
  hasAvailabilityBasis: boolean;
}): PlanningHypothesisSnapshot {
  const deadline = evaluateDeadlineSafety(params.state);
  let resolved = [...params.snapshot.readiness.resolvedDimensions];
  let unresolved = [...params.snapshot.readiness.unresolvedDimensions];
  let blocking = [...params.snapshot.readiness.blockingDimensions];

  if (!params.hasAvailabilityBasis) {
    resolved = removeDimension(resolved, 'availability_basis');
    unresolved = addDimension(unresolved, 'availability_basis');
    blocking = addDimension(blocking, 'availability_basis');
  }

  if (deadline.required) {
    if (deadline.resolved) {
      resolved = addDimension(resolved, 'deadline');
      unresolved = removeDimension(unresolved, 'deadline');
      blocking = removeDimension(blocking, 'deadline');
    } else {
      resolved = removeDimension(resolved, 'deadline');
      unresolved = addDimension(unresolved, 'deadline');
      blocking = addDimension(blocking, 'deadline');
    }
  }

  const authorizationCurrent = params.state.draftGenerationIntent === 'user_authorized'
    && params.state.draftGenerationAuthorizedAtRevision === params.snapshot.stateRevision;
  const draftGenerationIntent = authorizationCurrent ? 'user_authorized' as const : 'not_requested' as const;
  const normalizedResolved = unique(resolved);
  const normalizedUnresolved = unique(unresolved);
  const normalizedBlocking = unique(blocking);
  const stage = normalizedBlocking.length > 0
    ? 'hypothesis_ready' as const
    : draftGenerationIntent === 'user_authorized'
      ? 'preview_ready' as const
      : 'proposal_ready' as const;

  const readiness = {
    ...params.snapshot.readiness,
    stage,
    resolvedDimensions: normalizedResolved,
    unresolvedDimensions: normalizedUnresolved,
    blockingDimensions: normalizedBlocking,
    resolvedCount: normalizedResolved.length,
    draftGenerationIntent,
  };
  const resolutionOpportunities = deriveMissingResolutionOpportunities(readiness);

  return {
    ...params.snapshot,
    readiness,
    resolutionOpportunities,
    suggestedNextAction: suggestedNextAction({
      blocking: normalizedBlocking,
      draftGenerationIntent,
      fallback: params.snapshot.suggestedNextAction,
    }),
  };
}

export function createSafeAllowedDialogueActions(
  snapshot: PlanningHypothesisSnapshot,
): AllowedDialogueAction[] {
  return createAllowedDialogueActions(snapshot).map((action) => ({
    ...action,
    allowedProposalRefs: [],
  }));
}

function isSafeUserVisibleText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && !INTERNAL_TERM.test(value)
    && !SAVE_CLAIM.test(value);
}

export function validateBehaviorAwareDialogueResponseStrict(params: {
  response: unknown;
  actions: AllowedDialogueAction[];
  previewAllowed: boolean;
}): BehaviorAwareDialogueResponse | null {
  if (!params.response || typeof params.response !== 'object') return null;
  const response = params.response as Partial<BehaviorAwareDialogueResponse>;
  if (!Array.isArray(response.selectedActionIds) || !Array.isArray(response.items)) return null;
  if (response.selectedActionIds.length === 0 || response.selectedActionIds.length > 3) return null;
  if (response.items.length === 0 || response.items.length > 3) return null;
  if (new Set(response.selectedActionIds).size !== response.selectedActionIds.length) return null;

  const allowedById = new Map(params.actions.map((action) => [action.actionId, action]));
  if (response.selectedActionIds.some((id) => typeof id !== 'string' || !allowedById.has(id))) {
    return null;
  }
  if (response.acknowledgement !== undefined && !isSafeUserVisibleText(response.acknowledgement)) {
    return null;
  }
  if (response.reasoningSummary !== undefined && !isSafeUserVisibleText(response.reasoningSummary)) {
    return null;
  }

  const itemCounts = new Map<string, number>();
  const itemActionIds: string[] = [];
  for (const item of response.items) {
    if (!item || typeof item.actionId !== 'string' || !isSafeUserVisibleText(item.text)) return null;
    const action = allowedById.get(item.actionId);
    if (!action || !response.selectedActionIds.includes(item.actionId)) return null;
    if (action.kind === 'generate_preview' && !params.previewAllowed) return null;
    if (item.optionIds !== undefined) {
      if (!Array.isArray(item.optionIds) || item.optionIds.some((id) => typeof id !== 'string')) return null;
      if (new Set(item.optionIds).size !== item.optionIds.length) return null;
      if (item.optionIds.some((id) => !action.allowedOptionIds.includes(id))) return null;
    }
    const count = (itemCounts.get(item.actionId) ?? 0) + 1;
    if (count > action.maxItems) return null;
    itemCounts.set(item.actionId, count);
    itemActionIds.push(item.actionId);
  }

  if (new Set(itemActionIds).size !== itemActionIds.length) return null;
  if (
    response.selectedActionIds.length !== itemActionIds.length
    || response.selectedActionIds.some((id) => !itemActionIds.includes(id))
  ) {
    return null;
  }

  return {
    acknowledgement: response.acknowledgement,
    selectedActionIds: [...response.selectedActionIds],
    items: response.items.map((item) => ({
      actionId: item.actionId,
      text: item.text,
      optionIds: item.optionIds ? [...item.optionIds] : undefined,
    })),
    reasoningSummary: response.reasoningSummary,
  };
}

export function evaluateHardenedPreviewGate(params: {
  snapshot: PlanningHypothesisSnapshot;
  hasExecutionShape: boolean;
  hasAvailabilityBasis: boolean;
}): PreviewGateResult {
  const readiness = params.snapshot.readiness;
  if (readiness.draftGenerationIntent !== 'user_authorized') {
    return { allowed: false, reason: 'not_user_authorized' };
  }
  if (!params.hasExecutionShape) {
    return { allowed: false, reason: 'missing_execution_shape' };
  }
  if (!params.hasAvailabilityBasis) {
    return { allowed: false, reason: 'missing_availability_basis' };
  }
  if (readiness.blockingDimensions.length > 0) {
    return { allowed: false, reason: 'blocking_dimension' };
  }
  if (readiness.stage !== 'preview_ready') {
    return { allowed: false, reason: 'not_ready' };
  }
  return { allowed: true, reason: 'allowed' };
}
