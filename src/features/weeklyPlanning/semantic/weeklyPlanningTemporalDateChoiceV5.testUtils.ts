import { expect } from 'vitest';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';

export function temporalDateFixtureV5(withIndependentCondition = false) {
  const userText = '10月5日から11日の間に進めたいです。18時から20時は予定を入れられません。'
    + (withIndependentCondition ? '10月10日は8時から9時に勉強できます。' : '');
  const document: WeeklyPlanningSemanticDocumentV5 = {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss',
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-10-05/2026-10-11', start: '2026-10-05', end: '2026-10-11', sourceText: '10月5日から11日' },
    tasks: [], relations: [], availabilityDeclarations: [{ localId: 'time', kind: 'unavailable', dateExpression: null, namedTimePeriod: null,
      startTime: '18:00', endTime: '20:00', recurrenceKind: null, days: [], constraintLevel: 'hard', capacityMinutes: null, sourceText: '18時から20時は予定を入れられません' }],
    constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  };
  if (withIndependentCondition) document.availabilityDeclarations.push({ localId: 'other-time', kind: 'available',
    dateExpression: '2026-10-10', namedTimePeriod: null, startTime: '08:00', endTime: '09:00',
    recurrenceKind: null, days: [], constraintLevel: 'hard', capacityMinutes: null, sourceText: '10月10日は8時から9時に勉強できます' });
  const validated = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: userText });
  expect(validated.errors).toEqual([]);
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(), document: validated.document!,
    context: { conversationId: 'conversation', turnId: 'initial', expectedRevision: 0 } });
  expect(result.status).toBe('applied');
  const graph = result.graph; const target = graph.availabilityDeclarations[0];
  return { graph, target, domainPolicyVersion: 'diagnostic-date-policy-v1', calendar: { referenceDate: '2026-10-05', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' as const }, input: { userText: '10月7日です', traceRequestId: 'date-answer', committedGraph: graph,
    publicStateSummary: { pendingQuestion: { actionId: 'question-date', questionCode: 'missing_availability_date_scope', targetFactId: target.id, graphRevision: graph.revision } } },
    binding: { ownerId: 'owner', conversationId: 'conversation', requestId: 'date-answer', inputRevision: 4, graphRevision: graph.revision,
      sources: [], target: { kind: 'availability_declaration', id: target.id }, scope: {},
      question: { id: 'question-date', code: 'missing_availability_date_scope', presentingTurnId: 'presenting-turn', presentingMessageId: 'presenting-message', presentationRevision: 4 }, selectionEpoch: 1 } };
}
