import {
  clarificationKeywordTarget,
  messageKeyForMissing,
  QUESTION_PLAN_SLOT_ORDER,
  QUESTION_SLOT_DEFINITION_BY_MISSING,
  termExplanationForSlot,
  type PlanningQuestionSlotKind,
} from '../intake/weeklyPlanningQuestionSlots';
import type { RequestClarificationCommand } from '../intake/weeklyPlanningCommandTypes';
import type { WeeklyPlanningDraftRequest } from '../intake/weeklyPlanningDraftRequestAdapter';
import type {
  LifeConstraint,
  PlanningAssumption,
  PlanningIntakeMissing,
  PlanningIntakeState,
  StudyProgressAmbiguity,
  WeeklyPlanningQuestionContext,
} from '../intake/weeklyPlanningIntakeTypes';
import type {
  WeeklyPlanningRemainingWorkItemsResult,
} from '../intake/weeklyPlanningRemainingWorkItems';
import type {
  WeeklyDraftCandidate,
  WeeklyDraftCandidateDiagnostics,
} from '../scheduling/weeklyDraftCandidateGenerator';

export type WeeklyPlanningDialogueDecisionKind =
  | 'ask_missing_info'
  | 'answer_clarification'
  | 'confirm_ambiguity'
  | 'confirm_draft_conditions'
  | 'offer_dry_run_preview'
  | 'ask_relax_constraints'
  | 'cannot_create_draft'
  | 'open_planning_dialogue'
  | 'explain_capability_gap';

export interface WeeklyPlanningDialogueDecisionSummary {
  yearRange?: {
    startYear: number;
    endYear: number;
    sourceText: string;
  };
  fields?: string[];
  completedYears?: Array<{
    field?: string;
    years: number[];
  }>;
  fixedEventCount?: number;
  lifeConstraintKinds?: LifeConstraint['kind'][];
  remainingWorkItemCount?: number;
  totalRequestedMinutes?: number;
  totalScheduledMinutes?: number;
  unscheduledItemCount?: number;
  constraintConflictCount?: number;
  fixedEventConflictCount?: number;
  lifeConstraintConflictCount?: number;
  assumptions?: string[];
  previewAssumptions?: PlanningAssumption[];
}

export type WeeklyPlanningQuestionPlanKind = PlanningQuestionSlotKind;

export interface WeeklyPlanningQuestionPlanItem {
  kind: WeeklyPlanningQuestionPlanKind;
  targetSlot: string;
  missing: PlanningIntakeMissing[];
  intent: string;
  dependsOn?: PlanningIntakeMissing[];
  targetFields?: string[];
}

export interface WeeklyPlanningDialogueDecision {
  kind: WeeklyPlanningDialogueDecisionKind;
  messageKey: string;
  requiredFields?: string[];
  questionPlan?: WeeklyPlanningQuestionPlanItem[];
  ambiguities?: string[];
  summary?: WeeklyPlanningDialogueDecisionSummary;
  /** answer_clarification のときの、解決済み対象とdeterministicな説明。 */
  clarification?: {
    explanation: string;
    targetSlot?: string;
    intent?: string;
  };
  shouldCreateDraft: boolean;
  shouldSavePlan: false;
}

export interface WeeklyPlanningDialogueDecisionInput {
  state: PlanningIntakeState;
  draftRequest?: WeeklyPlanningDraftRequest | null;
  remainingWorkItems?: WeeklyPlanningRemainingWorkItemsResult | null;
  dryRunCandidates?: WeeklyDraftCandidate | WeeklyDraftCandidate[] | null;
  dryRunDiagnostics?: WeeklyDraftCandidateDiagnostics | null;
  assumedDraft?: {
    draftRequest: WeeklyPlanningDraftRequest;
    assumptions: PlanningAssumption[];
    candidates: WeeklyDraftCandidate[];
    diagnostics: WeeklyDraftCandidateDiagnostics;
  };
}

const MAX_MISSING_QUESTIONS_PER_TURN = 2;

function uniqueList<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function missingMessageKey(missing: PlanningIntakeMissing[]): string {
  return messageKeyForMissing(missing);
}

export function createMissingQuestionPlan(
  state: PlanningIntakeState,
): WeeklyPlanningQuestionPlanItem[] {
  const missingSet = new Set(state.missing);
  const candidates = QUESTION_PLAN_SLOT_ORDER
    .filter((definition) =>
      definition.missing.some((missing) => missingSet.has(missing))
      && definition.isQuestionPlanEligible(state, missingSet),
    )
    .map((definition) => ({
      kind: definition.kind,
      targetSlot: definition.targetSlot,
      missing: definition.missing.filter((missing) => missingSet.has(missing)),
      intent: definition.intent,
      dependsOn: definition.dependsOn ? [...definition.dependsOn] : undefined,
      targetFields: definition.targetFields?.(state),
    }));

  return candidates
    .filter((item) => !item.dependsOn?.some((dependency) => missingSet.has(dependency)))
    .slice(0, MAX_MISSING_QUESTIONS_PER_TURN);
}

function hasBlockingMissing(missing: PlanningIntakeMissing[]): boolean {
  return missing.some(
    (slot) => QUESTION_SLOT_DEFINITION_BY_MISSING[slot].previewPolicy === 'blocking',
  );
}

function createPreviewQuestionPlan(
  state: PlanningIntakeState,
): WeeklyPlanningQuestionPlanItem[] {
  const missingSet = new Set(state.missing);

  return QUESTION_PLAN_SLOT_ORDER
    .filter((definition) =>
      definition.previewQuestionPriority !== undefined
      && definition.missing.some((missing) => missingSet.has(missing))
      && definition.isQuestionPlanEligible(state, missingSet),
    )
    .sort(
      (left, right) =>
        (left.previewQuestionPriority ?? Number.MAX_SAFE_INTEGER)
        - (right.previewQuestionPriority ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, 1)
    .map((definition) => ({
      kind: definition.kind,
      targetSlot: definition.targetSlot,
      missing: definition.missing.filter((missing) => missingSet.has(missing)),
      intent: definition.intent,
      dependsOn: definition.dependsOn ? [...definition.dependsOn] : undefined,
      targetFields: definition.targetFields?.(state),
    }));
}

function normalizeProgressAmbiguity(
  ambiguity: StudyProgressAmbiguity,
): string | null {
  return ambiguity === 'none' ? null : ambiguity;
}

function collectAmbiguities(input: WeeklyPlanningDialogueDecisionInput): string[] {
  const progressAmbiguities = input.state.progress
    .map((progress) => normalizeProgressAmbiguity(progress.ambiguity))
    .filter((ambiguity): ambiguity is string => Boolean(ambiguity));
  const remainingAmbiguities = (input.remainingWorkItems?.ambiguities ?? []).filter((ambiguity) =>
    ambiguity === 'completed_years_without_field_scope',
  );
  const softFixedEvents = input.state.constraints
    .filter((constraint) => constraint.kind === 'fixed_event' && constraint.hardness === 'soft')
    .map(() => 'fixed_event_uncertain');

  return uniqueList([...progressAmbiguities, ...remainingAmbiguities, ...softFixedEvents]);
}

function activeDraftRequest(
  input: WeeklyPlanningDialogueDecisionInput,
): WeeklyPlanningDraftRequest | null | undefined {
  return input.draftRequest ?? input.assumedDraft?.draftRequest;
}

function activeDiagnostics(
  input: WeeklyPlanningDialogueDecisionInput,
): WeeklyDraftCandidateDiagnostics | null | undefined {
  return input.dryRunDiagnostics ?? input.assumedDraft?.diagnostics;
}

function hasUnscheduledItems(
  diagnostics: WeeklyDraftCandidateDiagnostics | null | undefined,
): boolean {
  return Boolean(diagnostics?.unscheduledItems.length);
}

function hasDryRunPreview(input: WeeklyPlanningDialogueDecisionInput): boolean {
  const candidates = input.dryRunCandidates ?? input.assumedDraft?.candidates;
  return Boolean(Array.isArray(candidates) ? candidates.length && activeDiagnostics(input) : candidates && activeDiagnostics(input));
}

function summarizeCompletedYears(
  request: WeeklyPlanningDraftRequest | null | undefined,
): WeeklyPlanningDialogueDecisionSummary['completedYears'] | undefined {
  const completedYears = request?.progress
    .filter((progress) => (progress.completedYears ?? []).length > 0)
    .map((progress) => ({
      field: progress.field,
      years: [...(progress.completedYears ?? [])],
    }));

  return completedYears && completedYears.length > 0 ? completedYears : undefined;
}

function summarizeLifeConstraintKinds(
  request: WeeklyPlanningDraftRequest | null | undefined,
): LifeConstraint['kind'][] | undefined {
  const kinds = uniqueList((request?.constraints ?? []).map((constraint) => constraint.kind));
  return kinds.length > 0 ? kinds : undefined;
}

function createSummary(
  input: WeeklyPlanningDialogueDecisionInput,
): WeeklyPlanningDialogueDecisionSummary {
  const request = activeDraftRequest(input);
  const diagnostics = activeDiagnostics(input);

  return {
    yearRange: request?.examPrepScope.yearRange,
    fields: request?.examPrepScope.fields,
    completedYears: summarizeCompletedYears(request),
    fixedEventCount: request?.fixedEvents.length,
    lifeConstraintKinds: summarizeLifeConstraintKinds(request),
    remainingWorkItemCount: input.remainingWorkItems?.items.length,
    totalRequestedMinutes: diagnostics?.totalRequestedMinutes,
    totalScheduledMinutes: diagnostics?.totalScheduledMinutes,
    unscheduledItemCount: diagnostics?.unscheduledItems.length,
    constraintConflictCount: diagnostics?.constraintConflicts.length,
    fixedEventConflictCount: diagnostics?.fixedEventConflicts.length,
    lifeConstraintConflictCount: diagnostics?.lifeConstraintConflicts.length,
    assumptions: input.state.assumptions.length > 0 ? [...input.state.assumptions] : undefined,
    previewAssumptions: input.assumedDraft?.assumptions.length
      ? [...input.assumedDraft.assumptions]
      : undefined,
  };
}

function createDecision(params: {
  kind: WeeklyPlanningDialogueDecisionKind;
  messageKey: string;
  requiredFields?: string[];
  questionPlan?: WeeklyPlanningQuestionPlanItem[];
  ambiguities?: string[];
  summary?: WeeklyPlanningDialogueDecisionSummary;
  shouldCreateDraft?: boolean;
}): WeeklyPlanningDialogueDecision {
  return {
    kind: params.kind,
    messageKey: params.messageKey,
    requiredFields: params.requiredFields
      ?? params.questionPlan?.map((question) => question.targetSlot),
    questionPlan: params.questionPlan,
    ambiguities: params.ambiguities,
    summary: params.summary,
    shouldCreateDraft: params.shouldCreateDraft ?? false,
    shouldSavePlan: false,
  };
}

export function createWeeklyPlanningDialogueDecision(
  input: WeeklyPlanningDialogueDecisionInput,
): WeeklyPlanningDialogueDecision {
  const missing = uniqueList(input.state.missing);

  if (hasBlockingMissing(missing)) {
    return createDecision({
      kind: 'ask_missing_info',
      messageKey: missingMessageKey(missing),
      questionPlan: createMissingQuestionPlan(input.state),
    });
  }

  const ambiguities = collectAmbiguities(input);

  if (ambiguities.length > 0) {
    return createDecision({
      kind: 'confirm_ambiguity',
      messageKey: 'confirm_intake_ambiguity',
      ambiguities,
    });
  }

  if (input.state.shouldCreateDraft && !input.draftRequest && !input.assumedDraft) {
    if (input.state.tasks.length > 0 && !input.state.examPrepScope) {
      return createDecision({
        kind: 'explain_capability_gap',
        messageKey: 'explain_weekly_planning_capability_gap',
        summary: createSummary(input),
      });
    }

    return createDecision({
      kind: 'cannot_create_draft',
      messageKey: 'cannot_create_draft_from_intake',
      summary: createSummary(input),
    });
  }

  if (hasUnscheduledItems(activeDiagnostics(input))) {
    return createDecision({
      kind: 'ask_relax_constraints',
      messageKey: 'ask_relax_constraints_for_unscheduled_items',
      summary: createSummary(input),
    });
  }

  if (hasDryRunPreview(input)) {
    return createDecision({
      kind: 'offer_dry_run_preview',
      messageKey: 'offer_weekly_plan_dry_run_preview',
      questionPlan: createPreviewQuestionPlan(input.state),
      summary: createSummary(input),
      shouldCreateDraft: true,
    });
  }

  if (missing.length > 0) {
    return createDecision({
      kind: 'ask_missing_info',
      messageKey: missingMessageKey(missing),
      questionPlan: createMissingQuestionPlan(input.state),
    });
  }

  if (input.state.status === 'draft_ready' && input.draftRequest) {
    return createDecision({
      kind: 'confirm_draft_conditions',
      messageKey: 'confirm_weekly_draft_conditions',
      summary: createSummary(input),
      shouldCreateDraft: true,
    });
  }

  if (
    input.state.intent === 'unknown'
    && input.state.tasks.length === 0
    && !input.state.examPrepScope
    && missing.length === 0
  ) {
    return createDecision({
      kind: 'open_planning_dialogue',
      messageKey: 'open_weekly_planning_dialogue',
    });
  }

  return createDecision({
    kind: 'open_planning_dialogue',
    messageKey: 'open_weekly_planning_dialogue',
    summary: createSummary(input),
  });
}

const GENERIC_CLARIFICATION =
  'この質問は、計画を作るために必要な条件をうかがっているものです。分かる範囲で教えてください。';

const CONTEXTUAL_CLARIFICATION_EXPLANATIONS: Record<string, string> = {
  constraint_relaxation:
    '現在の条件ではすべてを配置できないため、何を優先し、分割し、後へ回すかを確認しています。',
  availability_basis:
    '予定を入れられる時間を判断するために、時間割・登録済み予定・直接指定のどれを使うか確認しています。',
  feasibility_basis:
    '無理のない予定にするために、実際に勉強へ使える時間の根拠を確認しています。',
  preview_confirmation:
    '作成した仮予定をこのまま使うか、条件を直して作り直すかを確認しています。',
  draft_confirmation:
    '確認した条件で仮予定を作ってよいかを確認しています。',
  draft_generation_confirmation:
    'ここまでの条件を使って仮予定を作り始めてよいかを確認しています。',
  ambiguity_resolution:
    '複数の解釈ができる条件について、どちらの意味かを確認しています。',
  planning_purpose:
    'どの種類の学習を計画するかを決めるために、試験・宿題・提出物などの目的を確認しています。',
};

function resolveExplicitClarificationTermKey(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  if (termExplanationForSlot(ref)) return ref;
  return clarificationKeywordTarget(ref);
}

function resolveClarificationTargetSlot(params: {
  target?: RequestClarificationCommand['target'];
  ref?: string;
  previousQuestionContext?: WeeklyPlanningQuestionContext;
}): string | undefined {
  if (params.target === 'referenced_question') {
    return params.previousQuestionContext?.targetSlot;
  }

  const explicitTermKey = resolveExplicitClarificationTermKey(params.ref);
  if (explicitTermKey) return explicitTermKey;

  if (params.target === 'unresolved_slot' && params.ref) {
    return params.ref;
  }

  return params.previousQuestionContext?.targetSlot;
}

function clarificationExplanation(targetSlot: string | undefined): string {
  if (!targetSlot) return GENERIC_CLARIFICATION;
  return termExplanationForSlot(targetSlot)
    ?? CONTEXTUAL_CLARIFICATION_EXPLANATIONS[targetSlot]
    ?? GENERIC_CLARIFICATION;
}

/**
 * 聞き返し(request_clarification)への応答決定を作る。
 * command targetに従って明示用語または直前の実質問を解決し、同じtargetをrendererまで伝播する。
 */
export function createWeeklyPlanningClarificationDecision(params: {
  state: PlanningIntakeState;
  target?: RequestClarificationCommand['target'];
  ref?: string;
  previousQuestionContext?: WeeklyPlanningQuestionContext;
}): WeeklyPlanningDialogueDecision {
  const targetSlot = resolveClarificationTargetSlot(params);
  const explanation = clarificationExplanation(targetSlot);
  const questionPlan = targetSlot
    ? createMissingQuestionPlan(params.state).filter((question) => question.targetSlot === targetSlot)
    : [];
  const intent = params.previousQuestionContext?.targetSlot === targetSlot
    ? params.previousQuestionContext.intent
    : questionPlan[0]?.intent;

  return {
    kind: 'answer_clarification',
    messageKey: 'answer_term_clarification',
    requiredFields: targetSlot ? [targetSlot] : undefined,
    questionPlan: questionPlan.length > 0 ? questionPlan : undefined,
    clarification: {
      explanation,
      ...(targetSlot ? { targetSlot } : {}),
      ...(intent ? { intent } : {}),
    },
    shouldCreateDraft: false,
    shouldSavePlan: false,
  };
}
