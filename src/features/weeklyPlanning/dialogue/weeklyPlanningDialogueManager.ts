import {
  clarificationKeywordTarget,
  termExplanationForSlot,
} from '../intake/weeklyPlanningQuestionSlots';
import type { RequestClarificationCommand } from '../intake/weeklyPlanningCommandTypes';
import type {
  PlanningIntakeState,
  WeeklyPlanningQuestionContext,
} from '../intake/weeklyPlanningIntakeTypes';
import {
  createMissingQuestionPlan,
} from './weeklyPlanningDialogueManagerCore';

export {
  createMissingQuestionPlan,
  createWeeklyPlanningDialogueDecision,
} from './weeklyPlanningDialogueManagerCore';
export type {
  WeeklyPlanningDialogueDecisionKind,
  WeeklyPlanningDialogueDecisionSummary,
  WeeklyPlanningQuestionPlanKind,
  WeeklyPlanningQuestionPlanItem,
  WeeklyPlanningDialogueDecision,
  WeeklyPlanningDialogueDecisionInput,
} from './weeklyPlanningDialogueManagerCore';
import type { WeeklyPlanningDialogueDecision } from './weeklyPlanningDialogueManagerCore';

const GENERIC_CLARIFICATION =
  'この質問は、計画を作るために必要な条件をうかがっているものです。分かる範囲で教えてください。';

const CONTEXTUAL_EXPLANATIONS: Record<string, string> = {
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

function explicitTarget(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  if (termExplanationForSlot(ref)) return ref;
  return clarificationKeywordTarget(ref);
}

function resolveTarget(params: {
  target?: RequestClarificationCommand['target'];
  ref?: string;
  previousQuestionContext?: WeeklyPlanningQuestionContext;
}): string | undefined {
  if (params.target === 'referenced_question') {
    return params.previousQuestionContext?.targetSlot;
  }
  const termTarget = explicitTarget(params.ref);
  if (termTarget) return termTarget;
  if (params.target === 'unresolved_slot' && params.ref) return params.ref;
  return params.previousQuestionContext?.targetSlot;
}

function explanationFor(targetSlot: string | undefined): string {
  if (!targetSlot) return GENERIC_CLARIFICATION;
  return termExplanationForSlot(targetSlot)
    ?? CONTEXTUAL_EXPLANATIONS[targetSlot]
    ?? GENERIC_CLARIFICATION;
}

export function createWeeklyPlanningClarificationDecision(params: {
  state: PlanningIntakeState;
  target?: RequestClarificationCommand['target'];
  ref?: string;
  previousQuestionContext?: WeeklyPlanningQuestionContext;
}): WeeklyPlanningDialogueDecision {
  const targetSlot = resolveTarget(params);
  const questionPlan = targetSlot
    ? createMissingQuestionPlan(params.state).filter((question) => question.targetSlot === targetSlot)
    : [];
  const previousQuestionContext = params.previousQuestionContext;
  const intent = targetSlot && previousQuestionContext?.targetSlot === targetSlot
    ? previousQuestionContext.intent
    : questionPlan[0]?.intent;

  return {
    kind: 'answer_clarification',
    messageKey: 'answer_term_clarification',
    requiredFields: targetSlot ? [targetSlot] : undefined,
    questionPlan: questionPlan.length > 0 ? questionPlan : undefined,
    clarification: {
      explanation: explanationFor(targetSlot),
      ...(targetSlot ? { targetSlot } : {}),
      ...(intent ? { intent } : {}),
    },
    shouldCreateDraft: false,
    shouldSavePlan: false,
  };
}
