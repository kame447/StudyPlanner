import type {
  LifeConstraint,
  PlanningIntakeState,
  StudyTaskScope,
} from '../intake/weeklyPlanningIntakeTypes';
import type {
  AllowedDialogueAction,
  BehaviorAwareDialogueResponse,
  DraftGenerationIntent,
  LifeActivityAnchor,
  LifeActivityKind,
  MissingResolutionOpportunity,
  PlanningDimension,
  PlanningHypothesisSnapshot,
  PlanningOpportunityAnnotation,
  PlanningOpportunityTag,
  PlanningReadinessPolicy,
  PlanningReadinessSnapshot,
  PreviewGateResult,
  StudyActivityKind,
  TaskDistributionPolicy,
  TaskExecutionProfile,
} from './weeklyPlanningBehaviorTypes';

const ALL_DIMENSIONS: PlanningDimension[] = [
  'planning_intent',
  'planning_range',
  'task_identity',
  'goal_scope',
  'workload',
  'deadline',
  'task_execution_profile',
  'availability_basis',
  'routine_anchors',
];

export const WEEKLY_PLANNING_READINESS_POLICIES: Record<
  PlanningReadinessPolicy['policyId'],
  PlanningReadinessPolicy
> = {
  non_exam_weekly_plan: {
    policyId: 'non_exam_weekly_plan',
    hardRequiredDimensions: [
      'planning_intent',
      'planning_range',
      'task_identity',
      'workload',
      'task_execution_profile',
      'availability_basis',
    ],
    countedDimensions: [...ALL_DIMENSIONS],
    minimumResolvedCount: 6,
    previewRequiredDimensions: [
      'planning_intent',
      'planning_range',
      'task_identity',
      'workload',
      'task_execution_profile',
      'availability_basis',
    ],
  },
  exam_weekly_plan: {
    policyId: 'exam_weekly_plan',
    hardRequiredDimensions: [
      'planning_intent',
      'planning_range',
      'task_identity',
      'goal_scope',
      'workload',
      'task_execution_profile',
      'availability_basis',
    ],
    countedDimensions: [...ALL_DIMENSIONS],
    minimumResolvedCount: 7,
    previewRequiredDimensions: [
      'planning_intent',
      'planning_range',
      'task_identity',
      'goal_scope',
      'workload',
      'task_execution_profile',
      'availability_basis',
    ],
  },
};

const EXPLICIT_DRAFT_REQUEST =
  /(?:仮(?:の)?予定|予定|計画)(?:を|で|も)?(?:組んで|作って|作りたい|立てて|出して|生成して|お願い)|(?:仮で|この条件で)(?:組んで|作って)|予定作成を?(?:始めて|お願い)/;
const VAGUE_STUDY_GOAL =
  /(?:やらないと|勉強しないと|進めないと|そろそろ(?:勉強|課題))/;

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function latestTurn(state: PlanningIntakeState, currentUserText?: string): string {
  return currentUserText ?? state.sourceTurns[state.sourceTurns.length - 1] ?? '';
}

export function deriveDraftGenerationIntent(params: {
  state: PlanningIntakeState;
  currentUserText?: string;
  assistantSuggested?: boolean;
}): DraftGenerationIntent {
  const text = latestTurn(params.state, params.currentUserText);

  if (EXPLICIT_DRAFT_REQUEST.test(text) && !VAGUE_STUDY_GOAL.test(text)) {
    return 'user_authorized';
  }

  if (params.assistantSuggested) {
    return 'assistant_suggested';
  }

  return 'not_requested';
}

function policyForState(state: PlanningIntakeState): PlanningReadinessPolicy {
  return state.examPrepScope
    ? WEEKLY_PLANNING_READINESS_POLICIES.exam_weekly_plan
    : WEEKLY_PLANNING_READINESS_POLICIES.non_exam_weekly_plan;
}

function hasUsableRange(state: PlanningIntakeState): boolean {
  return Boolean(
    state.range
    && state.range.confidence !== 'missing'
    && (state.range.startDateTime || state.range.calendarDayCount),
  );
}

function taskHasWorkload(task: StudyTaskScope, state: PlanningIntakeState): boolean {
  if (task.unit === 'minutes') {
    return typeof task.amount === 'number' && task.amount > 0;
  }

  if (task.unit === 'hours') {
    return typeof task.amount === 'number' && task.amount > 0;
  }

  if (typeof task.amount !== 'number' || task.amount <= 0) {
    return false;
  }

  if (!task.requiresTimeEstimate) {
    return true;
  }

  return state.unitRates.some(
    (rate) => rate.unit === task.unit && typeof rate.minutesPerUnit === 'number',
  );
}

function hasAvailabilityBasis(state: PlanningIntakeState): boolean {
  return Boolean(
    state.constraints.length > 0
    || state.constraintSourcesInUse?.length
    || state.fixedEventsDeclaredNone,
  );
}

function sourceTextContainsDeadline(state: PlanningIntakeState): boolean {
  return state.sourceTurns.some((turn) =>
    /(?:締切|期限|提出|テスト|試験|小テスト|までに|曜日まで|月曜|火曜|水曜|木曜|金曜|土曜|日曜)/.test(turn),
  );
}

function resolveDimensions(params: {
  state: PlanningIntakeState;
  taskProfiles: TaskExecutionProfile[];
}): Set<PlanningDimension> {
  const { state, taskProfiles } = params;
  const resolved = new Set<PlanningDimension>();

  if (state.intent !== 'unknown') resolved.add('planning_intent');
  if (hasUsableRange(state)) resolved.add('planning_range');
  if (state.tasks.length > 0 || Boolean(state.examPrepScope?.fields.length)) {
    resolved.add('task_identity');
  }
  if (state.examPrepScope || state.tasks.some((task) => Boolean(task.title.trim()))) {
    resolved.add('goal_scope');
  }
  if (
    (state.tasks.length > 0 && state.tasks.every((task) => taskHasWorkload(task, state)))
    || Boolean(state.examPrepScope && state.unitRates.some((rate) => typeof rate.minutesPerUnit === 'number'))
  ) {
    resolved.add('workload');
  }
  if (sourceTextContainsDeadline(state) || Boolean(state.examPrepScope?.examType)) {
    resolved.add('deadline');
  }
  if (taskProfiles.length > 0 && taskProfiles.every((profile) => profile.activityKind !== 'unknown')) {
    resolved.add('task_execution_profile');
  }
  if (hasAvailabilityBasis(state)) resolved.add('availability_basis');
  if (state.constraints.length > 0) resolved.add('routine_anchors');

  return resolved;
}

function missingSlotForDimension(dimension: PlanningDimension): string | undefined {
  switch (dimension) {
    case 'planning_range':
      return 'planning_period';
    case 'task_identity':
    case 'goal_scope':
      return 'tasks_or_goals';
    case 'workload':
    case 'task_execution_profile':
      return 'unit_duration_estimate';
    case 'availability_basis':
      return 'life_constraints';
    case 'routine_anchors':
      return 'life_constraints';
    default:
      return undefined;
  }
}

export function evaluatePlanningReadiness(params: {
  state: PlanningIntakeState;
  taskProfiles: TaskExecutionProfile[];
  draftGenerationIntent: DraftGenerationIntent;
}): PlanningReadinessSnapshot {
  const policy = policyForState(params.state);
  const resolvedSet = resolveDimensions({
    state: params.state,
    taskProfiles: params.taskProfiles,
  });
  const resolvedDimensions = policy.countedDimensions.filter((dimension) => resolvedSet.has(dimension));
  const unresolvedDimensions = policy.countedDimensions.filter((dimension) => !resolvedSet.has(dimension));
  const blockingDimensions = policy.previewRequiredDimensions.filter(
    (dimension) => !resolvedSet.has(dimension),
  );
  const hasPlanningSubject = resolvedSet.has('planning_intent') || resolvedSet.has('task_identity');
  const stateRevision = params.state.sourceTurns.length;
  let stage: PlanningReadinessSnapshot['stage'];

  if (!hasPlanningSubject) {
    stage = 'exploration';
  } else if (blockingDimensions.length > 0) {
    stage = 'hypothesis_ready';
  } else if (params.draftGenerationIntent === 'user_authorized') {
    stage = 'preview_ready';
  } else {
    stage = 'proposal_ready';
  }

  return {
    stage,
    resolvedDimensions,
    unresolvedDimensions,
    blockingDimensions,
    resolvedCount: resolvedDimensions.length,
    policyId: policy.policyId,
    draftGenerationIntent: params.draftGenerationIntent,
    allowedAssumptionSlots: unique(
      unresolvedDimensions
        .map(missingSlotForDimension)
        .filter((slot): slot is string => Boolean(slot)),
    ),
    stateRevision,
  };
}

function constraintKindToAnchorKind(constraint: LifeConstraint): LifeActivityKind | null {
  switch (constraint.kind) {
    case 'meal': return 'meal';
    case 'bath': return 'bath';
    case 'sleep': return 'sleep';
    case 'commute': return 'commute';
    case 'cram_school': return 'school';
    case 'club': return 'fixed_event';
    case 'fixed_event':
    case 'unavailable': return 'fixed_event';
    case 'buffer': return 'preparation';
    default: return null;
  }
}

function clockFromJapanese(text: string, label: RegExp): string | undefined {
  const match = text.match(
    new RegExp(`${label.source}[^0-9]{0,8}(\\d{1,2})(?::(\\d{1,2})|時(?:(\\d{1,2})分?)?)`),
  );
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? match[3] ?? 0);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 24 || minute < 0 || minute > 59) {
    return undefined;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function deriveLifeActivityAnchors(
  state: PlanningIntakeState,
): LifeActivityAnchor[] {
  const constraintAnchors = state.constraints.flatMap((constraint, index) => {
    const kind = constraintKindToAnchorKind(constraint);
    if (!kind) return [];
    return [{
      anchorId: `constraint-anchor-${index}`,
      kind,
      date: constraint.date,
      startTime: constraint.start,
      endTime: constraint.end ?? constraint.studyAvailableStart,
      sourceFactRefs: [`constraint:${index}`],
      origin: 'user_explicit' as const,
      scope: constraint.date ? 'current_plan' as const : 'current_week' as const,
      confidence: constraint.hardness === 'hard' ? 'high' as const : 'medium' as const,
    }];
  });

  const sourceAnchors = state.sourceTurns.flatMap((turn, turnIndex) => {
    const anchors: LifeActivityAnchor[] = [];
    const returnHome = clockFromJapanese(turn, /帰宅|家に着/);
    const dinner = clockFromJapanese(turn, /夕食|晩ごはん|晩御飯/);

    if (returnHome) {
      anchors.push({
        anchorId: `turn-${turnIndex}-commute-end`,
        kind: 'commute',
        endTime: returnHome,
        sourceFactRefs: [`turn:${turnIndex}`],
        origin: 'user_explicit',
        scope: 'current_week',
        confidence: 'high',
      });
    }
    if (dinner) {
      anchors.push({
        anchorId: `turn-${turnIndex}-meal`,
        kind: 'meal',
        startTime: dinner,
        sourceFactRefs: [`turn:${turnIndex}`],
        origin: 'user_explicit',
        scope: 'current_week',
        confidence: 'high',
      });
    }
    if (/寝る前|就寝前/.test(turn)) {
      anchors.push({
        anchorId: `turn-${turnIndex}-before-sleep`,
        kind: 'sleep',
        sourceFactRefs: [`turn:${turnIndex}`],
        origin: 'user_explicit',
        scope: 'current_week',
        confidence: 'medium',
      });
    }
    return anchors;
  });

  const seen = new Set<string>();
  return [...constraintAnchors, ...sourceAnchors].filter((anchor) => {
    const key = [anchor.kind, anchor.date, anchor.startTime, anchor.endTime, ...anchor.sourceFactRefs].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface TaskProfilePolicy {
  matches: RegExp;
  activityKind: StudyActivityKind;
  distributionPolicy: TaskDistributionPolicy;
  cognitiveLoad: TaskExecutionProfile['cognitiveLoad'];
  minSessionMinutes: number;
  targetSessionMinutes: number;
  maxSessionMinutes: number;
}

const TASK_PROFILE_POLICIES: TaskProfilePolicy[] = [
  {
    matches: /単語|英単語|暗記|用語|語彙/,
    activityKind: 'memorization',
    distributionPolicy: 'spaced',
    cognitiveLoad: 'light',
    minSessionMinutes: 10,
    targetSessionMinutes: 20,
    maxSessionMinutes: 45,
  },
  {
    matches: /ワーク|ドリル|問題集|演習|練習問題/,
    activityKind: 'drill',
    distributionPolicy: 'sequential_units',
    cognitiveLoad: 'medium',
    minSessionMinutes: 30,
    targetSessionMinutes: 60,
    maxSessionMinutes: 90,
  },
  {
    matches: /レポート|作文|論文|執筆|記述/,
    activityKind: 'writing',
    distributionPolicy: 'contiguous',
    cognitiveLoad: 'heavy',
    minSessionMinutes: 45,
    targetSessionMinutes: 90,
    maxSessionMinutes: 120,
  },
  {
    matches: /読書|読む|読解|教科書/,
    activityKind: 'reading',
    distributionPolicy: 'splittable',
    cognitiveLoad: 'medium',
    minSessionMinutes: 20,
    targetSessionMinutes: 45,
    maxSessionMinutes: 90,
  },
  {
    matches: /復習|見直し/,
    activityKind: 'review',
    distributionPolicy: 'spaced',
    cognitiveLoad: 'light',
    minSessionMinutes: 15,
    targetSessionMinutes: 30,
    maxSessionMinutes: 60,
  },
];

function profileForTask(task: StudyTaskScope, index: number): TaskExecutionProfile {
  const normalized = `${task.title} ${task.subject ?? ''} ${task.rawText}`;
  const policy = TASK_PROFILE_POLICIES.find((candidate) => candidate.matches.test(normalized));
  const taskRef = `task:${index}`;

  if (!policy) {
    return {
      taskRef,
      activityKind: 'unknown',
      distributionPolicy: 'splittable',
      cognitiveLoad: 'unknown',
      sourceFactRefs: [taskRef],
      confidence: 'low',
      origin: 'deterministic_derived',
    };
  }

  return {
    taskRef,
    activityKind: policy.activityKind,
    distributionPolicy: policy.distributionPolicy,
    cognitiveLoad: policy.cognitiveLoad,
    minSessionMinutes: policy.minSessionMinutes,
    targetSessionMinutes: policy.targetSessionMinutes,
    maxSessionMinutes: policy.maxSessionMinutes,
    sourceFactRefs: [taskRef],
    confidence: 'medium',
    origin: 'deterministic_derived',
  };
}

export function deriveTaskExecutionProfiles(
  state: PlanningIntakeState,
): TaskExecutionProfile[] {
  if (state.tasks.length > 0) {
    return state.tasks.map(profileForTask);
  }

  return (state.examPrepScope?.fields ?? []).map((field, index) => ({
    taskRef: `exam-field:${index}`,
    activityKind: 'problem_solving',
    distributionPolicy: 'contiguous',
    cognitiveLoad: 'heavy',
    minSessionMinutes: 30,
    targetSessionMinutes: 90,
    maxSessionMinutes: 120,
    sourceFactRefs: [`exam-field:${field}`],
    confidence: 'medium',
    origin: 'deterministic_derived',
  }));
}

export interface AvailabilityRangeReference {
  ref: string;
  startTime?: string;
  endTime?: string;
  sourceFactRefs: string[];
}

function minutes(time: string | undefined): number | undefined {
  if (!time) return undefined;
  const [hour, minute = 0] = time.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  return hour * 60 + minute;
}

export function derivePlanningOpportunityAnnotations(params: {
  availabilityRanges: AvailabilityRangeReference[];
  anchors: LifeActivityAnchor[];
  state: PlanningIntakeState;
}): PlanningOpportunityAnnotation[] {
  const morningAvoided = params.state.sourceTurns.some((turn) =>
    /朝(?:は|だと).*(?:続かない|苦手|無理|できない)/.test(turn),
  );

  return params.availabilityRanges.map((range) => {
    const tags: PlanningOpportunityTag[] = [];
    const anchorRefs: string[] = [];
    const rangeStart = minutes(range.startTime);
    const rangeEnd = minutes(range.endTime);

    for (const anchor of params.anchors) {
      const anchorStart = minutes(anchor.startTime);
      const anchorEnd = minutes(anchor.endTime);
      if (anchor.kind === 'meal' && rangeEnd !== undefined && anchorStart !== undefined && rangeEnd <= anchorStart) {
        tags.push('before_meal');
        anchorRefs.push(anchor.anchorId);
      }
      if (anchor.kind === 'meal' && rangeStart !== undefined && anchorEnd !== undefined && rangeStart >= anchorEnd) {
        tags.push('after_meal');
        anchorRefs.push(anchor.anchorId);
      }
      if (anchor.kind === 'commute' && rangeStart !== undefined && anchorEnd !== undefined && rangeStart >= anchorEnd) {
        tags.push('after_commute');
        anchorRefs.push(anchor.anchorId);
      }
      if (anchor.kind === 'sleep' && /before-sleep/.test(anchor.anchorId)) {
        tags.push('before_sleep');
        anchorRefs.push(anchor.anchorId);
      }
    }

    if (rangeStart !== undefined && rangeEnd !== undefined) {
      const duration = rangeEnd - rangeStart;
      if (duration >= 90) tags.push('long_contiguous_window', 'high_continuity');
      if (duration > 0 && duration < 45) tags.push('short_transition_window');
      if (morningAvoided && rangeStart < 12 * 60) tags.push('low_activation');
    }

    const uniqueTags = unique(tags);
    return {
      availabilityRangeRef: range.ref,
      anchorRefs: unique(anchorRefs),
      tags: uniqueTags,
      suitabilityByActivity: {
        memorization: uniqueTags.includes('before_sleep') || uniqueTags.includes('short_transition_window') ? 3 : 1,
        drill: uniqueTags.includes('long_contiguous_window') ? 3 : 1,
        problem_solving: uniqueTags.includes('high_continuity') ? 3 : 1,
        writing: uniqueTags.includes('long_contiguous_window') ? 3 : 1,
        reading: uniqueTags.includes('low_activation') ? 1 : 2,
      },
      sourceFactRefs: unique([
        ...range.sourceFactRefs,
        ...params.anchors.flatMap((anchor) => anchor.sourceFactRefs),
      ]),
    };
  });
}

function resolutionForDimension(
  dimension: PlanningDimension,
): MissingResolutionOpportunity {
  switch (dimension) {
    case 'planning_intent':
      return {
        topicId: 'planning-purpose',
        dimension,
        mode: 'must_confirm',
        impact: 'high',
        uncertainty: 'high',
        allowedOptionIds: ['exam', 'homework', 'submission', 'general-study'],
        sourceFactRefs: [],
      };
    case 'planning_range':
      return {
        topicId: 'planning-range',
        dimension,
        mode: 'offer_options',
        impact: 'high',
        uncertainty: 'medium',
        proposalSlot: 'planning_period',
        allowedOptionIds: ['this-week', 'next-week', 'weekend'],
        sourceFactRefs: [],
      };
    case 'task_identity':
    case 'goal_scope':
      return {
        topicId: 'task-identity',
        dimension,
        mode: 'must_confirm',
        impact: 'high',
        uncertainty: 'high',
        allowedOptionIds: [],
        sourceFactRefs: [],
      };
    case 'workload':
    case 'task_execution_profile':
      return {
        topicId: 'workload-estimate',
        dimension,
        mode: 'propose_default',
        impact: 'medium',
        uncertainty: 'medium',
        proposalSlot: 'unit_duration_estimate',
        allowedOptionIds: ['short-trial', 'rough-estimate', 'enter-own-estimate'],
        sourceFactRefs: [],
      };
    case 'deadline':
      return {
        topicId: 'deadline',
        dimension,
        mode: 'must_confirm',
        impact: 'high',
        uncertainty: 'high',
        allowedOptionIds: [],
        sourceFactRefs: [],
      };
    case 'availability_basis':
    case 'routine_anchors':
      return {
        topicId: 'availability-basis',
        dimension,
        mode: 'offer_options',
        impact: 'high',
        uncertainty: 'medium',
        proposalSlot: 'life_constraints',
        allowedOptionIds: ['use-timetable', 'use-existing-plans', 'enter-available-time'],
        sourceFactRefs: [],
      };
    default:
      return {
        topicId: dimension,
        dimension,
        mode: 'must_confirm',
        impact: 'medium',
        uncertainty: 'medium',
        allowedOptionIds: [],
        sourceFactRefs: [],
      };
  }
}

export function deriveMissingResolutionOpportunities(
  readiness: PlanningReadinessSnapshot,
): MissingResolutionOpportunity[] {
  return readiness.unresolvedDimensions
    .map(resolutionForDimension)
    .filter((opportunity, index, all) =>
      all.findIndex((candidate) => candidate.topicId === opportunity.topicId) === index,
    );
}

export function evaluatePreviewGate(params: {
  readiness: PlanningReadinessSnapshot;
  currentStateRevision: number;
  hasExecutionShape: boolean;
  hasAvailabilityBasis: boolean;
}): PreviewGateResult {
  if (params.readiness.draftGenerationIntent !== 'user_authorized') {
    return { allowed: false, reason: 'not_user_authorized' };
  }
  if (params.readiness.stateRevision !== params.currentStateRevision) {
    return { allowed: false, reason: 'stale_revision' };
  }
  if (!params.hasExecutionShape) {
    return { allowed: false, reason: 'missing_execution_shape' };
  }
  if (!params.hasAvailabilityBasis) {
    return { allowed: false, reason: 'missing_availability_basis' };
  }
  if (params.readiness.blockingDimensions.length > 0) {
    return { allowed: false, reason: 'blocking_dimension' };
  }
  if (params.readiness.stage !== 'preview_ready') {
    return { allowed: false, reason: 'not_ready' };
  }
  return { allowed: true, reason: 'allowed' };
}

function suggestedNextAction(params: {
  readiness: PlanningReadinessSnapshot;
  opportunities: MissingResolutionOpportunity[];
  gate: PreviewGateResult;
}): PlanningHypothesisSnapshot['suggestedNextAction'] {
  if (params.gate.allowed) return 'generate_preview';
  const proposal = params.opportunities.find((item) => item.mode === 'propose_default');
  if (proposal) return 'propose_resolution';
  const options = params.opportunities.find((item) => item.mode === 'offer_options');
  if (options) return 'offer_options';
  const required = params.opportunities.find((item) => item.mode === 'must_confirm');
  if (required) return 'ask_required_fact';
  if (
    params.readiness.blockingDimensions.length === 0
    && params.readiness.draftGenerationIntent !== 'user_authorized'
  ) {
    return 'suggest_draft_generation';
  }
  return 'acknowledge';
}

export function createPlanningHypothesisSnapshot(params: {
  state: PlanningIntakeState;
  currentUserText?: string;
  conversationId?: string;
  availabilityRanges?: AvailabilityRangeReference[];
}): PlanningHypothesisSnapshot {
  const taskProfiles = deriveTaskExecutionProfiles(params.state);
  const anchors = deriveLifeActivityAnchors(params.state);
  const intent = deriveDraftGenerationIntent({
    state: params.state,
    currentUserText: params.currentUserText,
  });
  const readiness = evaluatePlanningReadiness({
    state: params.state,
    taskProfiles,
    draftGenerationIntent: intent,
  });
  const opportunities = deriveMissingResolutionOpportunities(readiness);
  const annotations = derivePlanningOpportunityAnnotations({
    availabilityRanges: params.availabilityRanges ?? [],
    anchors,
    state: params.state,
  });
  const gate = evaluatePreviewGate({
    readiness,
    currentStateRevision: params.state.sourceTurns.length,
    hasExecutionShape: taskProfiles.length > 0 && taskProfiles.every((profile) => profile.activityKind !== 'unknown'),
    hasAvailabilityBasis: readiness.resolvedDimensions.includes('availability_basis'),
  });

  return {
    conversationId: params.conversationId ?? 'weekly-planning-session',
    stateRevision: readiness.stateRevision,
    taskProfiles,
    lifeActivityAnchors: anchors,
    opportunityAnnotations: annotations,
    resolutionOpportunities: opportunities,
    readiness,
    suggestedNextAction: suggestedNextAction({ readiness, opportunities, gate }),
  };
}

export function createAllowedDialogueActions(
  snapshot: PlanningHypothesisSnapshot,
): AllowedDialogueAction[] {
  const actions: AllowedDialogueAction[] = [{
    actionId: `acknowledge:${snapshot.stateRevision}`,
    kind: 'acknowledge_fact',
    topicId: 'current-facts',
    sourceFactRefs: unique([
      ...snapshot.taskProfiles.flatMap((profile) => profile.sourceFactRefs),
      ...snapshot.lifeActivityAnchors.flatMap((anchor) => anchor.sourceFactRefs),
    ]),
    allowedProposalRefs: [],
    allowedOptionIds: [],
    maxItems: 1,
  }];

  for (const opportunity of snapshot.resolutionOpportunities.slice(0, 2)) {
    const kind: AllowedDialogueAction['kind'] =
      opportunity.mode === 'propose_default'
        ? 'propose_default'
        : opportunity.mode === 'offer_options'
          ? 'show_options'
          : 'ask_required_fact';
    actions.push({
      actionId: `${kind}:${opportunity.topicId}:${snapshot.stateRevision}`,
      kind,
      topicId: opportunity.topicId,
      sourceFactRefs: [...opportunity.sourceFactRefs],
      allowedProposalRefs: opportunity.proposalSlot ? [opportunity.proposalSlot] : [],
      allowedOptionIds: [...opportunity.allowedOptionIds],
      maxItems: 1,
      displayHint: opportunity.topicId,
    });
  }

  if (
    snapshot.readiness.blockingDimensions.length === 0
    && snapshot.readiness.draftGenerationIntent !== 'user_authorized'
  ) {
    actions.push({
      actionId: `suggest-draft:${snapshot.stateRevision}`,
      kind: 'suggest_draft_generation',
      topicId: 'draft-generation',
      sourceFactRefs: [],
      allowedProposalRefs: [],
      allowedOptionIds: ['create-preview', 'revise-conditions'],
      maxItems: 1,
    });
  }

  if (
    snapshot.readiness.stage === 'preview_ready'
    && snapshot.readiness.blockingDimensions.length === 0
    && snapshot.readiness.draftGenerationIntent === 'user_authorized'
  ) {
    actions.push({
      actionId: `generate-preview:${snapshot.stateRevision}`,
      kind: 'generate_preview',
      topicId: 'draft-generation',
      sourceFactRefs: [],
      allowedProposalRefs: [],
      allowedOptionIds: [],
      maxItems: 1,
    });
  }

  return actions;
}

const INTERNAL_TERM = /(?:blockingDimensions|reasonCode|readiness|suitability|sourceFactRefs|proposalRef|slotKey)/i;
const SAVE_CLAIM = /(?:保存しました|確定しました|登録しました|予定に追加しました)/;

export function validateBehaviorAwareDialogueResponse(params: {
  response: unknown;
  actions: AllowedDialogueAction[];
  previewAllowed: boolean;
}): BehaviorAwareDialogueResponse | null {
  if (!params.response || typeof params.response !== 'object') return null;
  const response = params.response as Partial<BehaviorAwareDialogueResponse>;
  if (!Array.isArray(response.selectedActionIds) || !Array.isArray(response.items)) return null;
  const allowedById = new Map(params.actions.map((action) => [action.actionId, action]));
  if (response.selectedActionIds.length > 3) return null;
  if (response.selectedActionIds.some((id) => typeof id !== 'string' || !allowedById.has(id))) return null;
  if (response.items.length > 3) return null;

  for (const item of response.items) {
    if (!item || typeof item.actionId !== 'string' || typeof item.text !== 'string') return null;
    const action = allowedById.get(item.actionId);
    if (!action || !response.selectedActionIds.includes(item.actionId)) return null;
    if (INTERNAL_TERM.test(item.text) || SAVE_CLAIM.test(item.text)) return null;
    if (action.kind === 'generate_preview' && !params.previewAllowed) return null;
    if (item.optionIds?.some((id) => !action.allowedOptionIds.includes(id))) return null;
  }

  return {
    acknowledgement: typeof response.acknowledgement === 'string'
      ? response.acknowledgement
      : undefined,
    selectedActionIds: [...response.selectedActionIds],
    items: response.items.map((item) => ({
      actionId: item.actionId,
      text: item.text,
      optionIds: item.optionIds ? [...item.optionIds] : undefined,
    })),
    reasoningSummary: typeof response.reasoningSummary === 'string'
      ? response.reasoningSummary
      : undefined,
  };
}

export function renderBehaviorAwareDialogueFallback(params: {
  snapshot: PlanningHypothesisSnapshot;
  actions: AllowedDialogueAction[];
}): string {
  const selected = params.actions.filter((action) => action.kind !== 'acknowledge_fact').slice(0, 2);
  const profileSummary = params.snapshot.taskProfiles
    .filter((profile) => profile.activityKind !== 'unknown')
    .map((profile) => {
      if (profile.activityKind === 'memorization') return '暗記は短く分けて進める案';
      if (profile.activityKind === 'drill') return 'ワークや演習はまとまった時間で進める案';
      return null;
    })
    .filter((text): text is string => Boolean(text));
  const lines: string[] = [];

  if (profileSummary.length > 0) {
    lines.push(`${unique(profileSummary).join('、')}が合いそうです。`);
  } else {
    lines.push('ここまでの内容から、無理のない進め方を整理します。');
  }

  for (const action of selected) {
    switch (action.kind) {
      case 'propose_default':
        lines.push('目安がまだ決まっていなければ、短い試行から見積もる案にできます。');
        break;
      case 'show_options':
        lines.push('使える時間は、時間割・登録済み予定を使うか、空いている時間を直接教えてください。');
        break;
      case 'ask_required_fact':
        if (action.topicId === 'planning-purpose') {
          lines.push('試験、宿題、提出物のどれを進める予定か教えてください。');
        } else if (action.topicId === 'task-identity') {
          lines.push('具体的に何をどこまで進めたいか教えてください。');
        } else {
          lines.push('予定へ大きく影響する条件をもう少し確認させてください。');
        }
        break;
      case 'suggest_draft_generation':
        lines.push('この考え方で仮の予定を組んでよければ、そのように伝えてください。');
        break;
      case 'generate_preview':
        lines.push('確認した条件で仮予定を作成します。');
        break;
      default:
        break;
    }
  }

  return lines.slice(0, 3).join('\n');
}
