import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

/*
 * Semantic ownership boundary
 *
 * Contextual short answers must be interpreted by the semantic AI from the
 * current utterance, machine-readable pending question, conversation context,
 * and public Fact Graph summary. Deterministic code must not reconstruct a new
 * semantic document from Japanese phrases, quantities, units, or target labels.
 *
 * This compatibility function intentionally returns null so callers continue to
 * compile while the production path stops replacing the AI raw response.
 * Do not reintroduce regexes or scenario-specific branches here.
 *
 * Canonical rationale:
 * - docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md
 * - docs/ai/design/20260803-weekly-planning-semantic-ownership-phase2-design.md
 */
export interface GroundedContextualAnswerDocumentResultV5 {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
}

export function createGroundedContextualAnswerDocumentV5(_params: {
  userText: string;
  publicStateSummary?: Record<string, unknown>;
}): GroundedContextualAnswerDocumentResultV5 | null {
  return null;
}
