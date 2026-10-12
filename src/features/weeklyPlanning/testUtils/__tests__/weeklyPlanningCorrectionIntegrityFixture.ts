export type Json = Record<string, unknown>;
export const eventDocument = (extra: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], ...extra });
export function fixedEventTask(dateExpression = 'today') {
  return { localId: 'club', existingPublicId: null, decompositionStatus: 'atomic', category: 'non_study', title: '部活', study: null,
    workloads: [], effortEstimates: [], recurrence: [], durableContextSignals: [], sourceText: 'synthetic fixed event',
    temporalConstraints: [{ localId: 'club-time', targetLocalId: 'club', kind: 'fixed_interval', constraintLevel: 'hard', dateExpression,
      namedTimePeriod: null, startTime: '10:30', endTime: '12:00', precision: 'exact', sourceText: 'synthetic fixed event' }] };
}
export function eventStudyTask(unitCode = 'minute') {
  const sourceText = unitCode === 'minute' ? '数学を20分勉強する' : '数学の問題集を20問解く';
  return { localId: 'study', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '数学の問題集',
    study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
    workloads: [{ localId: 'study-amount', quantityRole: 'target', amount: 20, unitCode, unitLabel: unitCode === 'minute' ? '分' : '問',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText }],
    effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText };
}

import { createWeeklyPlanningSemanticPipelineV5 } from '../../semantic/weeklyPlanningSemanticPipelineV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../../semantic/weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningPendingQuestionV5 } from '../../semantic/weeklyPlanningPendingQuestionV5';
import { workloadLifecycleFixture } from './weeklyPlanningWorkloadLifecycleFixture';

export type CorrectionIntegrityScenario = 'role-rate' | 'role-session' | 'role-total' | 'paired-session' | 'paired-total' | 'window-changed' | 'window-identical' | 'window-cross-kind';

/** Typed accepted documents only: this fixture never calls a model or interprets input text. */
export async function runCorrectionIntegrityScenario(scenario: CorrectionIntegrityScenario, conversationId = 'lifecycle-synthetic', requestId = `integrity-${scenario}`) {
  let document = eventDocument() as unknown as WeeklyPlanningSemanticDocumentV5;
  const pipeline = createWeeklyPlanningSemanticPipelineV5({ normalize: async () => ({ status: 'accepted', document,
    diagnostics: { schemaVersion: 'weekly-planning-semantic-v5', jsonSchemaName: 'weekly_planning_semantic_document_v5',
      normalizerVersion: 'weekly-planning-semantic-normalizer-v5', attemptCount: 1, repairAttempted: false,
      requestBytes: [1], responseLengths: [1], latencyMs: 1, validationErrors: [], providerError: null } }) });
  const schedulerContext = { ownerId: 'integrity-owner', currentDate: '2026-10-10', planningStartDate: '2026-10-10', planningEndDate: '2026-10-16', timeZone: 'UTC' };
  const common = { conversationId, userText: 'synthetic accepted answer', recentConversation: [], schedulerContext };
  let originalGraph = workloadLifecycleFixture({ effortKind: scenario === 'role-rate' ? 'duration_per_unit' : (scenario === 'role-total' || scenario === 'paired-total') ? 'total_duration' : 'session_duration' });
  for (const fact of [...originalGraph.tasks, ...originalGraph.workloads, ...originalGraph.effortEstimates]) fact.source = { ...fact.source, conversationId };
  let pendingQuestion: WeeklyPlanningPendingQuestionV5 | null = null;
  if (scenario.startsWith('window-')) {
    document = eventDocument({ planningWindow: { localId: 'old-window', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: 'synthetic window' },
      uncertainties: [{ localId: 'need', targetLocalId: 'old-window', field: 'opaque', reason: 'synthetic period question', sourceText: 'synthetic window' }] }) as unknown as WeeklyPlanningSemanticDocumentV5;
    const initial = await pipeline.run({ ...common, graph: createEmptyWeeklyPlanningFactGraphV5(), turnId: 'window-initial', expectedRevision: 0, publicStateSummary: {} });
    originalGraph = initial.graph;
    pendingQuestion = { actionId: 'question', questionCode: 'semantic_uncertainty', targetFactId: initial.canonicalization!.localToFactId.need, graphRevision: originalGraph.revision };
    document = eventDocument({ planningWindow: scenario === 'window-cross-kind'
      ? { localId: 'new-window', kind: 'absolute', value: '2026-10-11/2026-10-11', start: '2026-10-11', end: '2026-10-11', sourceText: 'synthetic answer' }
      : { localId: 'new-window', kind: 'relative_day', value: scenario === 'window-changed' ? 'today' : 'tomorrow', start: null, end: null, sourceText: 'synthetic answer' } }) as unknown as WeeklyPlanningSemanticDocumentV5;
  } else {
    const study = eventStudyTask('problem');
    document = eventDocument({ tasks: [{ ...study, existingPublicId: 'task', title: 'synthetic', workloads: [{ ...study.workloads[0], localId: scenario.startsWith('paired-') ? 'study-amount' : 'work', amount: scenario.startsWith('paired-') ? 10 : 20 }],
      ...(scenario.startsWith('paired-') ? { effortEstimates: [{ localId: 'new-effort', targetLocalId: 'study-amount', kind: scenario === 'paired-total' ? 'total_duration' : 'session_duration', minutes: 2, unitCode: 'problem', precision: 'approximate', sourceText: 'synthetic answer' }] } : {}) }],
      ...(scenario.startsWith('paired-') ? { corrections: [
        { localId: 'work-correction', target: { kind: 'workload', publicId: 'work', localId: null, mention: null }, operation: 'modify', replacementLocalId: 'study-amount', sourceText: 'synthetic answer' },
        { localId: 'effort-correction', target: { kind: 'effort_estimate', publicId: 'pace', localId: null, mention: null }, operation: 'replace', replacementLocalId: 'new-effort', sourceText: 'synthetic answer' },
      ] } : {}) }) as unknown as WeeklyPlanningSemanticDocumentV5;
    if (!scenario.startsWith('paired-')) pendingQuestion = { actionId: 'question', questionCode: 'quantity_role_unresolved', targetFactId: 'work', graphRevision: originalGraph.revision };
  }
  const result = await pipeline.run({ ...common, graph: originalGraph, turnId: requestId, expectedRevision: originalGraph.revision, publicStateSummary: pendingQuestion ? { pendingQuestion } : {} });
  return { originalGraph, document, result, pendingQuestion, pipeline, common, requestId };
}
