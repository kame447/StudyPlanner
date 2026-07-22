import {
  createEmptyWeeklyPlanningFactGraphV5,
  WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import {
  SEMANTIC_TASK_DATE_RULE_KINDS_V5,
} from './weeklyPlanningSemanticDocumentV5';
import type {
  WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  WEEKLY_PLANNING_SEMANTIC_CANONICALIZER_VERSION_V5,
  WEEKLY_PLANNING_SEMANTIC_SHADOW_REPORT_VERSION_V5,
  WEEKLY_PLANNING_SEMANTIC_VALIDATOR_VERSION_V5,
} from './weeklyPlanningSemanticRuntimeVersionsV5';

export interface WeeklyPlanningSemanticShadowInputV5 {
  conversationId: string;
  turnId: string;
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
}

export interface WeeklyPlanningSemanticShadowReportV5 {
  reportVersion: typeof WEEKLY_PLANNING_SEMANTIC_SHADOW_REPORT_VERSION_V5;
  conversationId: string;
  turnId: string;
  outcome: 'accepted' | 'rejected' | 'provider_failure';
  canonicalizationOutcome: 'applied' | 'duplicate' | 'rejected' | 'not_run';
  semanticSchemaVersion: string;
  jsonSchemaName: string;
  factGraphVersion: typeof WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5;
  normalizerVersion: typeof WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5;
  validatorVersion: typeof WEEKLY_PLANNING_SEMANTIC_VALIDATOR_VERSION_V5;
  canonicalizerVersion: typeof WEEKLY_PLANNING_SEMANTIC_CANONICALIZER_VERSION_V5;
  attemptCount: number;
  repairAttempted: boolean;
  requestBytes: number[];
  responseLengths: number[];
  latencyMs: number;
  validationErrors: string[];
  providerError: string | null;
  canonicalizationErrors: string[];
  semanticCounts: {
    taskCount: number;
    studyTaskCount: number;
    nonStudyTaskCount: number;
    unknownTaskCount: number;
    componentCount: number;
    workloadCount: number;
    effortEstimateCount: number;
    temporalConstraintCount: number;
    taskDateRuleCount: number;
    recurrenceCount: number;
    relationCount: number;
    availabilityDeclarationCount: number;
    constraintSourceRequestCount: number;
    uncertaintyCount: number;
    correctionCount: number;
    decisionCount: number;
  };
  factCounts: {
    planningWindowCount: number;
    taskCount: number;
    studyContextCount: number;
    componentCount: number;
    workloadCount: number;
    effortEstimateCount: number;
    temporalConstraintCount: number;
    taskDateRuleCount: number;
    recurrenceCount: number;
    relationCount: number;
    availabilityDeclarationCount: number;
    constraintSourceRequestCount: number;
    uncertaintyCount: number;
    correctionIntentCount: number;
    decisionIntentCount: number;
  };
}

function emptySemanticCounts(): WeeklyPlanningSemanticShadowReportV5['semanticCounts'] {
  return {
    taskCount: 0,
    studyTaskCount: 0,
    nonStudyTaskCount: 0,
    unknownTaskCount: 0,
    componentCount: 0,
    workloadCount: 0,
    effortEstimateCount: 0,
    temporalConstraintCount: 0,
    taskDateRuleCount: 0,
    recurrenceCount: 0,
    relationCount: 0,
    availabilityDeclarationCount: 0,
    constraintSourceRequestCount: 0,
    uncertaintyCount: 0,
    correctionCount: 0,
    decisionCount: 0,
  };
}

function emptyFactCounts(): WeeklyPlanningSemanticShadowReportV5['factCounts'] {
  return {
    planningWindowCount: 0,
    taskCount: 0,
    studyContextCount: 0,
    componentCount: 0,
    workloadCount: 0,
    effortEstimateCount: 0,
    temporalConstraintCount: 0,
    taskDateRuleCount: 0,
    recurrenceCount: 0,
    relationCount: 0,
    availabilityDeclarationCount: 0,
    constraintSourceRequestCount: 0,
    uncertaintyCount: 0,
    correctionIntentCount: 0,
    decisionIntentCount: 0,
  };
}

function countFacts(
  graph: WeeklyPlanningFactGraphV5,
): WeeklyPlanningSemanticShadowReportV5['factCounts'] {
  return {
    planningWindowCount: graph.planningWindows.length,
    taskCount: graph.tasks.length,
    studyContextCount: graph.studyContexts.length,
    componentCount: graph.components.length,
    workloadCount: graph.workloads.length,
    effortEstimateCount: graph.effortEstimates.length,
    temporalConstraintCount: graph.temporalConstraints.length,
    taskDateRuleCount: graph.taskDateRules.length,
    recurrenceCount: graph.recurrences.length,
    relationCount: graph.relations.length,
    availabilityDeclarationCount: graph.availabilityDeclarations.length,
    constraintSourceRequestCount: graph.constraintSourceRequests.length,
    uncertaintyCount: graph.uncertainties.length,
    correctionIntentCount: graph.correctionIntents.length,
    decisionIntentCount: graph.decisionIntents.length,
  };
}

export async function evaluateWeeklyPlanningSemanticShadowV5(params: {
  normalizer: WeeklyPlanningSemanticNormalizerV5;
  input: WeeklyPlanningSemanticShadowInputV5;
}): Promise<WeeklyPlanningSemanticShadowReportV5> {
  const result = await params.normalizer.normalize({
    userText: params.input.userText,
    recentConversation: params.input.recentConversation,
    publicStateSummary: params.input.publicStateSummary,
  });
  const document = result.document;
  const semanticCounts = document
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
          (sum, task) => sum + task.temporalConstraints.filter(
            (constraint) => !(SEMANTIC_TASK_DATE_RULE_KINDS_V5 as readonly string[])
              .includes(constraint.kind),
          ).length,
          0,
        ),
        taskDateRuleCount: document.tasks.reduce(
          (sum, task) => sum + task.temporalConstraints.filter(
            (constraint) => (SEMANTIC_TASK_DATE_RULE_KINDS_V5 as readonly string[])
              .includes(constraint.kind),
          ).length,
          0,
        ),
        recurrenceCount: document.tasks.reduce(
          (sum, task) => sum + task.recurrence.length,
          0,
        ),
        relationCount: document.relations.length,
        availabilityDeclarationCount: document.availabilityDeclarations.length,
        constraintSourceRequestCount: document.constraintSourceRequests.length,
        uncertaintyCount: document.uncertainties.length,
        correctionCount: document.corrections.length,
        decisionCount: document.decisions.length,
      }
    : emptySemanticCounts();

  const canonicalization = document
    ? canonicalizeWeeklyPlanningSemanticDocumentV5({
        graph: createEmptyWeeklyPlanningFactGraphV5(),
        document,
        context: {
          conversationId: params.input.conversationId,
          turnId: params.input.turnId,
          expectedRevision: 0,
        },
      })
    : null;

  return {
    reportVersion: WEEKLY_PLANNING_SEMANTIC_SHADOW_REPORT_VERSION_V5,
    conversationId: params.input.conversationId,
    turnId: params.input.turnId,
    outcome: result.status,
    canonicalizationOutcome: canonicalization?.status ?? 'not_run',
    semanticSchemaVersion: result.diagnostics.schemaVersion,
    jsonSchemaName: result.diagnostics.jsonSchemaName,
    factGraphVersion: WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
    normalizerVersion: result.diagnostics.normalizerVersion,
    validatorVersion: WEEKLY_PLANNING_SEMANTIC_VALIDATOR_VERSION_V5,
    canonicalizerVersion: WEEKLY_PLANNING_SEMANTIC_CANONICALIZER_VERSION_V5,
    attemptCount: result.diagnostics.attemptCount,
    repairAttempted: result.diagnostics.repairAttempted,
    requestBytes: [...result.diagnostics.requestBytes],
    responseLengths: [...result.diagnostics.responseLengths],
    latencyMs: result.diagnostics.latencyMs,
    validationErrors: [...result.diagnostics.validationErrors],
    providerError: result.diagnostics.providerError,
    canonicalizationErrors: [...(canonicalization?.errors ?? [])],
    semanticCounts,
    factCounts: canonicalization?.status === 'applied'
      ? countFacts(canonicalization.graph)
      : emptyFactCounts(),
  };
}
