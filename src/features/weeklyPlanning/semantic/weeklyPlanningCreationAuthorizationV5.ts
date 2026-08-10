import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

/*
 * Semantic ownership boundary
 *
 * Creation authorization is user intent. The semantic AI must express it as
 * planningIntent or a decision after reading the utterance and current state.
 * Deterministic code may validate readiness and revision, but must not infer
 * create_plan from a phrase list.
 *
 * This compatibility function intentionally returns null. Do not add regexes,
 * synonyms, or scenario-specific branches here.
 *
 * Canonical rationale:
 * - docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md
 * - docs/ai/design/20260803-weekly-planning-semantic-ownership-phase2-design.md
 */
export function createGroundedCreationAuthorizationDocumentV5(
  _userText: string,
): WeeklyPlanningSemanticDocumentV5 | null {
  return null;
}
