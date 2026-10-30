// The natural reply of a VNext turn comes from the existing Stable V5 renderer.
// The confirmed result of the turn (the stated facts, the question asked, the
// preview shown) becomes the renderer's typed input through V5's own context
// helpers; the renderer explains and never changes state. Only what V5 cannot
// know is supplied here: an estimate question names the asked work's amount
// (which may be derived, e.g. total − completed), and a VNext-only question asks
// for clarification with its option labels required in the text.
// The renderer has no state authority: its text is stored only as what was shown
// (the presented question's shownText, for binding the next answer), never read
// as a fact. Breaks if the reply text is parsed back into facts or a failed render
// still presents its question. Tests: ExperimentalSession integration "explains each
// result through the Stable V5 renderer…", OptionChoice "offers Jev the displayed text…".
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
import { createVNextLineageResolver, withCurrentVNextReferences } from '../weeklyPlanningVNextWorkIdentity';
import { presentWeeklyPlanningVNextQuestion } from './weeklyPlanningVNextQuestionText';
import type { WeeklyPlanningVNextShownPreview } from './weeklyPlanningVNextSessionCheckpoint';

/** As many recent messages as the Stable V5 renderer reads. */
export const VNEXT_RECENT_MESSAGE_LIMIT = 4;

export interface WeeklyPlanningVNextMessage {
  role: 'user' | 'assistant';
  content: string;
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
  // The renderer's helpers follow exact ids, so they read the facts with current references.
  const { leafOf } = createVNextLineageResolver(state.graph);
  const graph = withCurrentVNextReferences(state.graph, (id) => leafOf(id) ?? id);
  const planningInformation = createWeeklyPlanningStableV5DialogueProjection(graph);
  const actionKind = question ? 'question' : preview ? 'preview_ready' : 'status';
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
