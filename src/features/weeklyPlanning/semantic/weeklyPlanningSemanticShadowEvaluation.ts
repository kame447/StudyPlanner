import type { WeeklyPlanningSemanticNormalizer } from './weeklyPlanningSemanticNormalizer';

export interface WeeklyPlanningSemanticShadowInput {
  conversationId: string;
  turnId: string;
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
}

export interface WeeklyPlanningSemanticShadowReport {
  conversationId: string;
  turnId: string;
  outcome: 'accepted' | 'rejected' | 'provider_failure';
  schemaVersion: string;
  attemptCount: number;
  repairAttempted: boolean;
  requestBytes: number[];
  responseLengths: number[];
  latencyMs: number;
  validationErrors: string[];
  providerError: string | null;
  semanticCounts: {
    taskCount: number;
    studyTaskCount: number;
    nonStudyTaskCount: number;
    unknownTaskCount: number;
    componentCount: number;
    workloadCount: number;
    effortEstimateCount: number;
    temporalConstraintCount: number;
    recurrenceCount: number;
    relationCount: number;
    uncertaintyCount: number;
    correctionCount: number;
    decisionCount: number;
  };
}

function emptyCounts(): WeeklyPlanningSemanticShadowReport['semanticCounts'] {
  return {
    taskCount: 0,
    studyTaskCount: 0,
    nonStudyTaskCount: 0,
    unknownTaskCount: 0,
    componentCount: 0,
    workloadCount: 0,
    effortEstimateCount: 0,
    temporalConstraintCount: 0,
    recurrenceCount: 0,
    relationCount: 0,
    uncertaintyCount: 0,
    correctionCount: 0,
    decisionCount: 0,
  };
}

export async function evaluateWeeklyPlanningSemanticShadow(params: {
  normalizer: WeeklyPlanningSemanticNormalizer;
  input: WeeklyPlanningSemanticShadowInput;
}): Promise<WeeklyPlanningSemanticShadowReport> {
  const result = await params.normalizer.normalize({
    userText: params.input.userText,
    recentConversation: params.input.recentConversation,
    publicStateSummary: params.input.publicStateSummary,
  });
  const document = result.document;
  const counts = document
    ? {
        taskCount: document.tasks.length,
        studyTaskCount: document.tasks.filter((task) => task.category === 'study').length,
        nonStudyTaskCount: document.tasks.filter((task) => task.category === 'non_study').length,
        unknownTaskCount: document.tasks.filter((task) => task.category === 'unknown').length,
        componentCount: document.tasks.reduce(
          (sum, task) => sum + (task.study?.components.length ?? 0),
          0,
        ),
        workloadCount: document.tasks.reduce(
          (sum, task) => sum
            + task.workloads.length
            + (task.study?.components.reduce(
              (componentSum, component) => componentSum + component.workloads.length,
              0,
            ) ?? 0),
          0,
        ),
        effortEstimateCount: document.tasks.reduce(
          (sum, task) => sum + task.effortEstimates.length,
          0,
        ),
        temporalConstraintCount: document.tasks.reduce(
          (sum, task) => sum + task.temporalConstraints.length,
          0,
        ),
        recurrenceCount: document.tasks.reduce(
          (sum, task) => sum + task.recurrence.length,
          0,
        ),
        relationCount: document.relations.length,
        uncertaintyCount: document.uncertainties.length,
        correctionCount: document.corrections.length,
        decisionCount: document.decisions.length,
      }
    : emptyCounts();

  return {
    conversationId: params.input.conversationId,
    turnId: params.input.turnId,
    outcome: result.status,
    schemaVersion: result.diagnostics.schemaVersion,
    attemptCount: result.diagnostics.attemptCount,
    repairAttempted: result.diagnostics.repairAttempted,
    requestBytes: [...result.diagnostics.requestBytes],
    responseLengths: [...result.diagnostics.responseLengths],
    latencyMs: result.diagnostics.latencyMs,
    validationErrors: [...result.diagnostics.validationErrors],
    providerError: result.diagnostics.providerError,
    semanticCounts: counts,
  };
}
