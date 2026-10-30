// The natural reply of a VNext turn comes from the existing Stable V5 renderer.
// The confirmed result of the turn (the stated facts, the question asked, the
// preview shown) becomes the renderer's typed input through V5's own context
// helpers; the renderer explains and never changes state. Only what V5 cannot
// know is supplied here: an estimate question names the asked work's amount
// (which may be derived, e.g. total − completed), and a VNext-only question asks
// for clarification with its option labels required in the text.
import type { VNextQuestion, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import {
  createWeeklyPlanningStableV5CurrentTurnGrounding,
  createWeeklyPlanningStableV5DialogueProjection,
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
  RENDERER_TECHNICAL_STOP,
  requiredLabelsForStableV5Dialogue,
  WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL,
  type WeeklyPlanningStableV5DialogueQuestionIntent,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from '../weeklyPlanningVNextV5Boundary';
import { createVNextLineageResolver } from '../weeklyPlanningVNextWorkIdentity';
import { presentWeeklyPlanningVNextQuestion } from './weeklyPlanningVNextQuestionText';
import type { WeeklyPlanningVNextShownPreview } from './weeklyPlanningVNextSessionCheckpoint';

/** As many recent messages as the Stable V5 renderer reads. */
export const VNEXT_RECENT_MESSAGE_LIMIT = 4;

export interface WeeklyPlanningVNextMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The graph as the renderer's helpers expect it: every reference names the current version of the
 * fact it points to (a renamed task keeps its work). Read-only; stored facts keep their history.
 */
function currentReferenceGraph(graph: WeeklyPlanningVNextState['graph']): WeeklyPlanningVNextState['graph'] {
  const { leafOf } = createVNextLineageResolver(graph);
  const current = (id: string) => leafOf(id) ?? id;
  const owned = <T extends { taskId: string; targetFactId: string }>(fact: T): T =>
    ({ ...fact, taskId: current(fact.taskId), targetFactId: current(fact.targetFactId) });
  return {
    ...graph,
    studyContexts: graph.studyContexts.map((fact) => ({ ...fact, taskId: current(fact.taskId) })),
    components: graph.components.map((fact) => ({ ...fact, taskId: current(fact.taskId),
      parentComponentId: fact.parentComponentId === null ? null : current(fact.parentComponentId) })),
    workloads: graph.workloads.map((fact) => ({ ...fact, taskId: current(fact.taskId),
      componentId: fact.componentId === null ? null : current(fact.componentId) })),
    effortEstimates: graph.effortEstimates.map(owned),
    temporalConstraints: graph.temporalConstraints.map(owned),
    taskDateRules: graph.taskDateRules.map(owned),
    recurrences: graph.recurrences.map(owned),
    relations: graph.relations.map((fact) => ({ ...fact, fromTaskId: current(fact.fromTaskId), toTaskId: current(fact.toTaskId) })),
  };
}

function questionIntent(state: WeeklyPlanningVNextState, question: VNextQuestion,
  planningInformation: Record<string, unknown>, targetFactId: string): WeeklyPlanningStableV5DialogueQuestionIntent | null {
  if (question.code === 'missing_effort_estimate' && question.forWork) {
    // Asked work is a target, or what remains (stated, or the total less what is done).
    const defining = state.graph.workloads.find((workload) => workload.id === question.forWork!.definingFactId);
    return { kind: 'effort_measurement', measurement: 'total_duration',
      quantityRole: defining?.quantityRole === 'target' ? 'target' : 'remaining',
      targetFactId, amount: question.forWork.amount, unitCode: null, unitLabel: question.forWork.unitLabel };
  }
  const questionTarget = questionTargetForStableV5Dialogue({ planningInformation, targetFactId });
  return questionIntentForStableV5Dialogue({ questionCode: question.code, questionTarget, planningInformation })
    ?? { kind: 'resolution_question', resolutionKind: 'semantic_clarification', targetFactId,
      requestedInformation: ['clarify_ambiguous_meaning'], allowedChoices: [], knownAmount: null, knownUnitLabel: null,
      ambiguityField: question.code, ambiguityReason: null };
}

export function createWeeklyPlanningVNextRenderInput(params: {
  state: WeeklyPlanningVNextState;
  question: VNextQuestion | null;
  preview: WeeklyPlanningVNextShownPreview | null;
  actionId: string;
  /** The turn whose accepted facts ground the reply. */
  turnId: string;
  previousQuestionCode: string | null;
  userText: string;
  recentConversation: readonly WeeklyPlanningVNextMessage[];
}): WeeklyPlanningStableV5DialogueRenderInput {
  const { state, question, preview } = params;
  const graph = currentReferenceGraph(state.graph);
  const planningInformation = createWeeklyPlanningStableV5DialogueProjection(graph);
  const actionKind = question ? 'question' : preview ? 'preview_ready' : 'status';
  const { leafOf } = createVNextLineageResolver(state.graph);
  const asked = question ? question.forWork?.definingFactId ?? question.taskId : null;
  const targetFactId = asked === null ? null : leafOf(asked) ?? asked;
  const optionLabels = question ? Object.values(presentWeeklyPlanningVNextQuestion(state, question).optionLabels) : [];
  return {
    communication: {
      goal: actionKind === 'question' ? 'ask_question' : actionKind === 'preview_ready' ? 'present_preview' : 'acknowledge',
      askQuestion: actionKind === 'question',
    },
    actionId: params.actionId,
    currentUserMessage: params.userText,
    recentConversation: params.recentConversation.slice(-VNEXT_RECENT_MESSAGE_LIMIT).map(({ role, content }) => ({ role, content })),
    planningInformation,
    currentTurnGrounding: createWeeklyPlanningStableV5CurrentTurnGrounding({ graph, turnId: params.turnId,
      actionKind, previousQuestionCode: params.previousQuestionCode, currentQuestionCode: question?.code ?? null }),
    actionKind,
    questionCode: question?.code ?? null,
    questionTarget: targetFactId ? questionTargetForStableV5Dialogue({ planningInformation, targetFactId }) : null,
    questionIntent: question && targetFactId ? questionIntent(state, question, planningInformation, targetFactId) : null,
    previewPromotionControlLabel: preview ? WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL : null,
    requiredLabels: [...new Set([...requiredLabelsForStableV5Dialogue({ planningInformation, targetFactId,
      includePreviewPromotionControl: preview !== null }), ...optionLabels])],
    fallbackText: RENDERER_TECHNICAL_STOP,
    previewCount: preview?.blocks.length ?? 0,
  };
}
