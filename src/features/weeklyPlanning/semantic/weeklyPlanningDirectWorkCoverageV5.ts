import type {
  SemanticWorkloadUnitCodeV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

/*
 * Semantic ownership boundary
 *
 * Production validation must not re-extract task names, quantities, units, or
 * correction cues from user text and compare them with the AI document. That is
 * a second semantic parser and can overwrite or reject otherwise valid AI
 * meaning.
 *
 * These compatibility functions intentionally report no deterministic semantic
 * expectations. Missing meaning is handled by the AI repair loop using the
 * original utterance and machine-readable state; structural validation remains
 * in the schema validator.
 *
 * Canonical rationale:
 * - docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md
 * - docs/ai/design/20260803-weekly-planning-semantic-ownership-phase2-design.md
 */
export const WEEKLY_PLANNING_DIRECT_WORK_COVERAGE_CONTRACT_V5 =
  'weekly-planning-direct-work-coverage-v5' as const;

export interface DirectWorkExpectationV5 {
  label: string;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
}

export function extractDirectWorkExpectationsV5(
  _userText: string,
): DirectWorkExpectationV5[] {
  return [];
}

export function missingDirectWorkExpectationsV5(_params: {
  userText: string;
  document: WeeklyPlanningSemanticDocumentV5;
}): DirectWorkExpectationV5[] {
  return [];
}

export function directWorkCoverageErrorsV5(_params: {
  userText: string;
  document: WeeklyPlanningSemanticDocumentV5;
}): string[] {
  return [];
}
