// The one audited seam through which the experimental VNext core (#926) reads
// Stable V5 contracts: the Fact Graph shape it keeps (and its lifecycle), the
// session envelope its checkpoint extends (read-only for migration), the deterministic preview
// scheduler it hands projected work to, and the dialogue renderer that explains a
// turn's result (its typed input, the context helpers that build it, and V5's
// contingency texts, and the recovery evidence for a failed turn; the renderer
// core is created without V5's prompt trace).
// Read-only; VNext never writes V5 state, preview, trace or storage, and no
// production module imports VNext.
export {
  createEmptyWeeklyPlanningFactGraphV5,
  type EffortEstimateFactV5,
  type TemporalConstraintFactV5,
  type WeeklyPlanningFactDiffV5,
  type WeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactKindV5,
  type WorkloadFactV5,
} from '../semantic/weeklyPlanningFactGraphV5';
export {
  parseWeeklyPlanningStableV5PersistedSession,
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
} from '../application/weeklyPlanningStableV5SessionCodec';
export { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PlacementEngine';
export { createStableV5ExternalConstraintSources } from '../application/weeklyPlanningStableV5ExternalSources';
export type { ExternalConstraintSourceSnapshot } from '../semantic/weeklyPlanningAvailabilityResolver';
export { evaluateWeeklyPlanningLearningStrategyProposalsV5 } from '../application/weeklyPlanningStableV5LearningStrategyProposal';
export {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
export { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
export type { WeeklyPlanningLearningStrategyProposalRecord } from '../intake/weeklyPlanningIntakeTypes';
export { applyAcceptedMemorySessionProjectionV5 } from '../semantic/weeklyPlanningAcceptedMemorySessionProjectionV5';
export { compileWeeklyPlanningMemoryCalibrationSchedulerInputV5 } from '../semantic/weeklyPlanningMemoryCalibrationSchedulerInputV5';
export { deriveWeeklyPlanningEstimateCalibration } from '../personalization/weeklyPlanningEstimateCalibration';
export { learningStrategyProposalIntentForStableV5Dialogue } from '../dialogue/weeklyPlanningStableV5DialogueContext';
export { createFocusedContextualAnswerMessagesV5, parseFocusedContextualAnswerDecisionV5,
  FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5, FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS } from '../semantic/weeklyPlanningFocusedContextualAnswerV5';
export { createFocusedContextualBindingSnapshotV5, isFocusedContextualBindingCurrentV5 } from '../semantic/weeklyPlanningFocusedContextualBindingV5';
export { createWeeklyPlanningStableV5DialogueRendererCore } from '../dialogue/weeklyPlanningStableV5AiDialogueRendererCore';
export {
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
  recoveryQuestionEvidenceForStableV5Dialogue,
  requiredLabelsForStableV5Dialogue,
  WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL,
} from '../dialogue/weeklyPlanningStableV5DialogueContext';
export type {
  WeeklyPlanningStableV5DialogueQuestionIntent,
  WeeklyPlanningStableV5DialogueRenderer,
  WeeklyPlanningStableV5DialogueRenderInput,
} from '../dialogue/weeklyPlanningStableV5DialogueContracts';
export { createWeeklyPlanningStableV5CurrentTurnGrounding } from '../dialogue/weeklyPlanningStableV5CurrentTurnGrounding';
export { RENDERER_PREVIEW_CONTINGENCY, RENDERER_TECHNICAL_STOP } from '../dialogue/weeklyPlanningStableV5TurnDialogueCore';
export { createWeeklyPlanningStableV5DialogueProjection } from '../semantic/weeklyPlanningStableV5DialogueProjection';
