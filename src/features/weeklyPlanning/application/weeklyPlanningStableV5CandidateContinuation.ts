import type { ControlledCandidateSemanticContribution } from './weeklyPlanningControlledCandidateDomains';
import { canonicalCandidateSerialization } from './candidateSelection/canonical';
import { validateWeeklyPlanningSemanticValueWithAvailabilityCorrectionsV5 } from '../semantic/weeklyPlanningAvailabilityCorrectionCompatibilityV5';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { validateWeeklyPlanningFactGraphValueV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';
import { WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5 } from '../semantic/weeklyPlanningSemanticPipelineV5';
import { WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5 } from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 } from '../semantic/weeklyPlanningSemanticTypesV5';
import type { WeeklyPlanningTurnExecutionInput } from '../weeklyPlanningTurnExecutionTypes';
import { continueWeeklyPlanningStableV5RuntimeTurn } from './weeklyPlanningStableV5RuntimeExecutor';
import { getOrCreateWeeklyPlanningStableV5RuntimeSession } from './weeklyPlanningStableV5RuntimeSession';
import { stableV5RequestContextForInput } from './weeklyPlanningStableV5SemanticContext';
import { weeklyPlanningStableV5ResultProjector } from './weeklyPlanningStableV5ResultProjection';
import { weeklyPlanningStableV5TurnResultProjector } from './weeklyPlanningStableV5TurnResultProjection';
import { weeklyPlanningStableV5RuntimeTraceLifecycle } from './weeklyPlanningStableV5RuntimeTraceLifecycle';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';

/** The controller owns the capability, final freshness check and atomic commit.
 * This continuation evaluates an already selected graph and never interprets raw text. */
export async function continueWeeklyPlanningSelectedCandidateTurn(
  input: WeeklyPlanningTurnExecutionInput & ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
  selectedGraph: WeeklyPlanningFactGraphV5,
  semanticContribution?: ControlledCandidateSemanticContribution,
) {
  const graph = structuredClone(selectedGraph);
  if (!validateWeeklyPlanningFactGraphValueV5(graph).graph) throw new Error('Invalid selected candidate graph.');
  if (semanticContribution && (semanticContribution.canonicalization.status !== 'applied'
    // Same availability-correction compatibility as the response validator (date-domain replacements).
    || !validateWeeklyPlanningSemanticValueWithAvailabilityCorrectionsV5(semanticContribution.document).document
    || canonicalCandidateSerialization(semanticContribution.canonicalization.graph) !== canonicalCandidateSerialization(graph)))
    throw new Error('Invalid formal candidate contribution.');
  const runtimeSession = getOrCreateWeeklyPlanningStableV5RuntimeSession({ ownerId: input.userId, conversationId: input.conversationId });
  const requestContext = stableV5RequestContextForInput(input).context;
  const pendingQuestionPresentation = resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: input.previousState, inputStateRevision: input.inputStateRevision,
    messages: input.messages, graphRevision: runtimeSession.graph.revision,
  });
  if (pendingQuestionPresentation.status !== 'fresh') throw new Error('Stale selected candidate question.');
  const superseded = graph.factLifecycles.filter(entry => entry.status === 'superseded'
    && runtimeSession.graph.factLifecycles.find(previous => previous.factId === entry.factId)?.status !== 'superseded')
    .map(entry => ({ kind: 'effort_estimate' as const, id: entry.factId }));
  const diff = { fromRevision: runtimeSession.graph.revision, toRevision: graph.revision, added: [], removed: [], superseded };
  weeklyPlanningStableV5TurnResultProjector.begin(input.traceRequestId);
  weeklyPlanningStableV5RuntimeTraceLifecycle.start(input);
  try {
    const core = continueWeeklyPlanningStableV5RuntimeTurn(input, {
      status: 'success', runtimeSession, requestContext, pendingQuestionPresentation,
      semantic: {
        pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
        status: 'scheduler_needs_resolution', graph, scheduler: null,
        // C5 selects existing facts. It creates no new document or authorization act.
        normalization: { status: 'accepted', document: semanticContribution?.document ?? null, diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
          jsonSchemaName: 'candidate_choice', attemptCount: 0, repairAttempted: false,
          requestBytes: [], responseLengths: [], latencyMs: 0, validationErrors: [], providerError: null,
        } },
        canonicalization: semanticContribution?.canonicalization ?? { status: 'applied', graph, diff, errors: [], localToFactId: {} },
      },
    }, { controlledSelection: true });
    const result = weeklyPlanningStableV5ResultProjector.core({ input, result: core });
    // All interpretation/typed planning has completed; renderer waits are outside semantic latency.
    input.semanticObservation?.finish('success');
    weeklyPlanningStableV5RuntimeTraceLifecycle.complete({ input, result });
    return await weeklyPlanningStableV5TurnResultProjector.project({ input, result });
  } catch (error) {
    weeklyPlanningStableV5RuntimeTraceLifecycle.fail({ input, error });
    throw error;
  }
}
